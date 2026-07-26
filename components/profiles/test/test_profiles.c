#include "unity.h"
#include "profiles.h"

TEST_CASE("nickname validation accepts bounded UTF-8", "[profiles]")
{
    char output[CONFIG_PA_MAX_NICKNAME_BYTES + 1];
    TEST_ASSERT_TRUE(profile_validate_nickname("  Gareth  ", output,
                                               sizeof(output)));
    TEST_ASSERT_EQUAL_STRING("Gareth", output);
    TEST_ASSERT_TRUE(profile_validate_nickname("玩家", output,
                                               sizeof(output)));
}

TEST_CASE("nickname validation rejects controls and invalid UTF-8", "[profiles]")
{
    char output[CONFIG_PA_MAX_NICKNAME_BYTES + 1];
    TEST_ASSERT_FALSE(profile_validate_nickname("", output, sizeof(output)));
    TEST_ASSERT_FALSE(profile_validate_nickname("bad\nname", output,
                                                sizeof(output)));
    TEST_ASSERT_FALSE(profile_validate_nickname("\xc0\xaf", output,
                                                sizeof(output)));
}
