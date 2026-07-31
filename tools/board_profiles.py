#!/usr/bin/env python3
"""Build PocketArcade board profiles and package the browser installer."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOGUE_PATH = ROOT / "boards" / "profiles.json"
INSTALLER_SOURCE = ROOT / "installer"
BRAND_ASSET = ROOT / "web" / "assets" / "logo-horizontal.webp"


class ProfileError(RuntimeError):
    pass


def load_catalogue() -> dict:
    try:
        catalogue = json.loads(CATALOGUE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ProfileError(f"cannot read {CATALOGUE_PATH}: {error}") from error

    if catalogue.get("schemaVersion") != 1:
        raise ProfileError("unsupported board profile schema")
    profiles = catalogue.get("profiles")
    if not isinstance(profiles, list) or not profiles:
        raise ProfileError("board profile catalogue is empty")
    return catalogue


def indexed_profiles(catalogue: dict) -> dict[str, dict]:
    profiles: dict[str, dict] = {}
    for profile in catalogue["profiles"]:
        profile_id = profile.get("id")
        if not isinstance(profile_id, str) or not re.fullmatch(
            r"[a-z0-9][a-z0-9-]*", profile_id
        ):
            raise ProfileError(f"invalid board profile id: {profile_id!r}")
        if profile_id in profiles:
            raise ProfileError(f"duplicate board profile id: {profile_id}")
        profiles[profile_id] = profile
    return profiles


def config_text(profile: dict) -> str:
    parts = []
    for relative in profile.get("sdkconfigDefaults", []):
        path = ROOT / relative
        if not path.is_file():
            raise ProfileError(
                f"{profile['id']}: missing sdkconfig defaults file {relative}"
            )
        parts.append(path.read_text(encoding="utf-8"))
    return "\n".join(parts)


def validate_profile(profile: dict) -> None:
    required = (
        "name",
        "idfTarget",
        "chipFamily",
        "sdkconfigDefaults",
        "buildDirectory",
        "status",
        "publish",
        "hardware",
    )
    missing = [key for key in required if key not in profile]
    if missing:
        raise ProfileError(
            f"{profile.get('id', '<unknown>')}: missing {', '.join(missing)}"
        )
    if profile["status"] not in {"verified", "provisional"}:
        raise ProfileError(f"{profile['id']}: invalid support status")
    if profile["publish"] and profile["status"] != "verified":
        raise ProfileError(
            f"{profile['id']}: provisional profiles cannot be published"
        )

    config = config_text(profile)
    if "CONFIG_SPIRAM=y" not in config:
        raise ProfileError(f"{profile['id']}: PSRAM is not enabled")
    if "CONFIG_SPIRAM_IGNORE_NOTFOUND=y" in config:
        raise ProfileError(
            f"{profile['id']}: PSRAM is optional but must be required"
        )
    sd_interfaces = sum(
        setting in config
        for setting in ("CONFIG_PA_SD_SDMMC=y", "CONFIG_PA_SD_SDSPI=y")
    )
    if sd_interfaces != 1:
        raise ProfileError(
            f"{profile['id']}: exactly one SD-card interface must be enabled"
        )


def validate_catalogue(catalogue: dict) -> dict[str, dict]:
    profiles = indexed_profiles(catalogue)
    for profile in profiles.values():
        validate_profile(profile)
    return profiles


def project_version() -> str:
    cmake = (ROOT / "CMakeLists.txt").read_text(encoding="utf-8")
    match = re.search(r'set\(PROJECT_VER\s+"([^"]+)"\)', cmake)
    if not match:
        raise ProfileError("PROJECT_VER was not found in CMakeLists.txt")
    return match.group(1)


def profile_for_id(profiles: dict[str, dict], profile_id: str) -> dict:
    try:
        return profiles[profile_id]
    except KeyError as error:
        choices = ", ".join(profiles)
        raise ProfileError(
            f"unknown board profile {profile_id!r}; choose from {choices}"
        ) from error


def build_profile(profile: dict) -> None:
    idf = shutil.which("idf.py")
    if not idf:
        raise ProfileError("idf.py is not available; activate ESP-IDF first")

    build_directory = ROOT / profile["buildDirectory"]
    sdkconfig = ROOT / "build" / f"sdkconfig-{profile['id']}"
    defaults = ";".join(
        str(ROOT / relative) for relative in profile["sdkconfigDefaults"]
    )
    build_directory.parent.mkdir(parents=True, exist_ok=True)
    command = [
        idf,
        "-B",
        str(build_directory),
        "-D",
        f"IDF_TARGET={profile['idfTarget']}",
        "-D",
        f"SDKCONFIG={sdkconfig}",
        "-D",
        f"SDKCONFIG_DEFAULTS={defaults}",
        "build",
    ]
    print(f"Building {profile['id']} in {build_directory.relative_to(ROOT)}")
    subprocess.run(command, cwd=ROOT, check=True)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def package_profile(profile: dict, output: Path, version: str) -> dict:
    build_directory = ROOT / profile["buildDirectory"]
    flasher_path = build_directory / "flasher_args.json"
    try:
        flasher = json.loads(flasher_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ProfileError(
            f"{profile['id']}: build first; cannot read {flasher_path}"
        ) from error

    flash_files = flasher.get("flash_files")
    if not isinstance(flash_files, dict) or not flash_files:
        raise ProfileError(f"{profile['id']}: flasher_args has no flash files")

    destination = output / "firmware" / profile["id"]
    destination.mkdir(parents=True, exist_ok=True)
    parts = []
    checksums = []
    used_names: set[str] = set()
    for offset_text, relative in sorted(
        flash_files.items(), key=lambda item: int(item[0], 0)
    ):
        source = build_directory / relative
        if not source.is_file():
            raise ProfileError(
                f"{profile['id']}: missing build artifact {source}"
            )
        name = source.name
        if name in used_names:
            raise ProfileError(
                f"{profile['id']}: duplicate artifact name {name}"
            )
        used_names.add(name)
        target = destination / name
        shutil.copy2(source, target)
        parts.append({"path": name, "offset": int(offset_text, 0)})
        checksums.append(f"{sha256(target)}  {name}")

    manifest = {
        "name": f"PocketArcade — {profile['name']}",
        "version": version,
        "new_install_prompt_erase": True,
        "builds": [
            {
                "chipFamily": profile["chipFamily"],
                "improv": False,
                "parts": parts,
            }
        ],
    }
    (destination / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    (destination / "checksums.sha256").write_text(
        "\n".join(checksums) + "\n", encoding="utf-8"
    )
    return {
        "id": profile["id"],
        "name": profile["name"],
        "status": profile["status"],
        "hardware": profile["hardware"],
        "notes": profile.get("notes", ""),
        "manifest": f"firmware/{profile['id']}/manifest.json",
    }


def package_installer(
    profiles: dict[str, dict],
    output: Path,
    version: str,
    include_provisional: bool,
) -> None:
    if not INSTALLER_SOURCE.is_dir():
        raise ProfileError(f"installer source is missing: {INSTALLER_SOURCE}")
    output.mkdir(parents=True, exist_ok=True)
    firmware_output = output / "firmware"
    if firmware_output.exists():
        shutil.rmtree(firmware_output)
    for source in INSTALLER_SOURCE.iterdir():
        target = output / source.name
        if source.is_dir():
            shutil.copytree(source, target, dirs_exist_ok=True)
        else:
            shutil.copy2(source, target)
    if not BRAND_ASSET.is_file():
        raise ProfileError(f"installer branding is missing: {BRAND_ASSET}")
    brand_output = output / "assets"
    brand_output.mkdir(parents=True, exist_ok=True)
    shutil.copy2(BRAND_ASSET, brand_output / BRAND_ASSET.name)

    packaged = []
    for profile in profiles.values():
        if not profile["publish"] and not include_provisional:
            continue
        packaged.append(package_profile(profile, output, version))
    if not packaged:
        raise ProfileError("no board profiles are eligible for packaging")

    boards = {
        "schemaVersion": 1,
        "product": "PocketArcade",
        "version": version,
        "boards": packaged,
    }
    (output / "boards.json").write_text(
        json.dumps(boards, indent=2) + "\n", encoding="utf-8"
    )
    (output / ".nojekyll").touch()
    print(f"Packaged {len(packaged)} profile(s) in {output}")


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("list", help="list board profiles")
    subparsers.add_parser("validate", help="validate all board profiles")

    build = subparsers.add_parser("build", help="build one board profile")
    build.add_argument("profile")
    subparsers.add_parser("build-all", help="build every board profile")

    package = subparsers.add_parser(
        "package", help="package builds as a GitHub Pages installer"
    )
    package.add_argument(
        "--output",
        type=Path,
        default=ROOT / "dist" / "pages",
        help="installer output directory",
    )
    package.add_argument("--version", help="firmware version label")
    package.add_argument(
        "--include-provisional",
        action="store_true",
        help="include hardware profiles that have not been verified",
    )
    return parser


def main() -> int:
    args = make_parser().parse_args()
    catalogue = load_catalogue()
    profiles = validate_catalogue(catalogue)

    if args.command == "list":
        for profile in profiles.values():
            published = "published" if profile["publish"] else "not published"
            print(
                f"{profile['id']}: {profile['name']} "
                f"({profile['status']}, {published})"
            )
    elif args.command == "validate":
        print(f"Validated {len(profiles)} PocketArcade board profiles")
    elif args.command == "build":
        build_profile(profile_for_id(profiles, args.profile))
    elif args.command == "build-all":
        for profile in profiles.values():
            build_profile(profile)
    elif args.command == "package":
        package_installer(
            profiles,
            args.output.resolve(),
            args.version or project_version(),
            args.include_provisional,
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ProfileError as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(2)
