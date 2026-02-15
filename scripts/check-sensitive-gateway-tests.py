#!/usr/bin/env python3

from __future__ import annotations

import argparse
import subprocess
import sys

SENSITIVE_FILE_TEST_PREFIXES = {
    "src/gateway/call.ts": ("src/gateway/",),
    "src/gateway/server-chat.ts": ("src/gateway/",),
    "src/gateway/server-methods-list.ts": ("src/gateway/",),
    "src/gateway/server-methods.ts": ("src/gateway/",),
    "src/gateway/session-utils.ts": ("src/gateway/",),
    "src/gateway/server-authz.ts": ("src/gateway/",),
    "src/gateway/operator-scopes.ts": ("src/gateway/",),
    "src/gateway/server/ws-connection/message-handler.ts": ("src/gateway/",),
    "src/gateway/server-methods/agent.ts": ("src/gateway/",),
    "src/gateway/server-methods/agent-job.ts": ("src/gateway/",),
    "src/gateway/server-methods/authz.ts": ("src/gateway/",),
    "src/gateway/server-methods/config.ts": ("src/gateway/",),
    "src/gateway/server-methods/ownership.ts": ("src/gateway/",),
    "src/gateway/server-methods/skills.ts": ("src/gateway/", "src/agents/"),
    "src/gateway/server-methods/sessions.ts": ("src/gateway/",),
    "src/gateway/server-methods/chat.ts": ("src/gateway/",),
    "src/gateway/server-methods/browser.ts": ("src/gateway/", "src/browser/"),
    "src/gateway/server-methods/nodes.ts": ("src/gateway/",),
    "src/gateway/server-methods/usage.ts": ("src/gateway/",),
    "src/gateway/server-broadcast.ts": ("src/gateway/",),
    "src/auto-reply/reply/commands-config.ts": (
        "src/auto-reply/reply/",
        "src/channels/plugins/",
        "src/slack/",
        "src/telegram/",
    ),
    "src/auto-reply/reply/commands-allowlist.ts": (
        "src/auto-reply/reply/",
        "src/channels/plugins/",
        "src/slack/",
        "src/telegram/",
    ),
    "src/channels/plugins/config-writes.ts": (
        "src/channels/plugins/",
        "src/auto-reply/reply/",
        "src/slack/",
        "src/telegram/",
    ),
}

TEST_PREFIXES = tuple(
    sorted(
        {
            prefix
            for prefixes in SENSITIVE_FILE_TEST_PREFIXES.values()
            for prefix in prefixes
        }
    )
)


def run_git_diff_names(compare_to: str) -> list[str]:
    output = subprocess.check_output(
        ["git", "diff", "--name-only", compare_to, "HEAD"],
        text=True,
        stderr=subprocess.STDOUT,
    )
    return [line.strip() for line in output.splitlines() if line.strip()]


def is_test_file(path: str) -> bool:
    return path.endswith(".test.ts") and path.startswith(TEST_PREFIXES)


def has_related_test_change(sensitive_path: str, changed_tests: list[str]) -> bool:
    expected_prefixes = SENSITIVE_FILE_TEST_PREFIXES[sensitive_path]
    return any(test_path.startswith(expected_prefixes) for test_path in changed_tests)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fail when sensitive gateway files change without related test changes.",
    )
    parser.add_argument("--compare-to", required=True, help="Git ref to diff against")
    args = parser.parse_args()

    try:
        changed_files = run_git_diff_names(args.compare_to)
    except subprocess.CalledProcessError as err:
        print("check-sensitive-gateway-tests: failed to read git diff", file=sys.stderr)
        print(err.output, file=sys.stderr)
        return 2

    if not changed_files:
        return 0

    changed_sensitive = sorted(path for path in changed_files if path in SENSITIVE_FILE_TEST_PREFIXES)
    if not changed_sensitive:
        return 0

    changed_tests = [path for path in changed_files if is_test_file(path)]
    if not changed_tests:
        changed_tests = []

    missing_related_tests = [
        sensitive_path
        for sensitive_path in changed_sensitive
        if not has_related_test_change(sensitive_path, changed_tests)
    ]
    if not missing_related_tests:
        return 0

    print(
        "Sensitive gateway auth/ownership files changed without related test changes.",
        file=sys.stderr,
    )
    print("Changed sensitive files:", file=sys.stderr)
    for path in changed_sensitive:
        print(f" - {path}", file=sys.stderr)
    print("Missing related test updates for:", file=sys.stderr)
    for path in missing_related_tests:
        prefixes = SENSITIVE_FILE_TEST_PREFIXES[path]
        joined = ", ".join(f"{prefix}**/*.test.ts" for prefix in prefixes)
        print(f" - {path} -> expected one test change under: {joined}", file=sys.stderr)
    if changed_tests:
        print("Detected changed tests:", file=sys.stderr)
        for path in changed_tests:
            print(f" - {path}", file=sys.stderr)
    else:
        print("No changed tests detected.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
