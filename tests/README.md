# Tests

`host/` contains dependency-free repository and embedded-asset checks runnable
with Python's standard library.

ESP-IDF Unity cases live in `components/profiles/test` and
`components/storage/test`. They exercise pure nickname and filesystem-boundary
logic in an ESP-IDF unit-test application. Hardware behavior is covered by the
documented acceptance checklist because DHCP station identity, removable-card
wiring, and captive-portal launch require real devices.
