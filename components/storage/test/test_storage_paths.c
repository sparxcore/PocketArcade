#include "unity.h"
#include "storage.h"

TEST_CASE("storage path validation blocks traversal", "[storage]")
{
    TEST_ASSERT_TRUE(storage_safe_relative_path("data/profiles/p_ab.json"));
    TEST_ASSERT_FALSE(storage_safe_relative_path("/data/profiles/x"));
    TEST_ASSERT_FALSE(storage_safe_relative_path("data/../logs/x"));
    TEST_ASSERT_FALSE(storage_safe_relative_path("data//x"));
    TEST_ASSERT_FALSE(storage_safe_relative_path("data\\x"));
}

TEST_CASE("application IDs use the reserved alphabet", "[storage]")
{
    TEST_ASSERT_TRUE(storage_valid_app_id("quiz-night-2"));
    TEST_ASSERT_FALSE(storage_valid_app_id("QuizNight"));
    TEST_ASSERT_FALSE(storage_valid_app_id("../quiz"));
    TEST_ASSERT_FALSE(storage_valid_app_id(""));
}
