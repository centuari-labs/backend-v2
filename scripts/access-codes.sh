#!/usr/bin/env bash
set -euo pipefail

# ── Defaults ────────────────────────────────────────────────────────
BASE_URL="https://api-staging.centuari.finance"
SECRET="${ACCESS_CODE_ADMIN_SECRET:-}"

# ── Colors ──────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ── Helpers ─────────────────────────────────────────────────────────
pretty_print() {
    if command -v jq &>/dev/null; then
        echo "$1" | jq .
    else
        echo "$1"
    fi
}

require_secret() {
    if [ -z "$SECRET" ]; then
        echo -e "${RED}Error: ACCESS_CODE_ADMIN_SECRET is not set.${NC}"
        echo "  export ACCESS_CODE_ADMIN_SECRET=\"your-secret-here\""
        exit 1
    fi
}

usage() {
    echo -e "${CYAN}Usage:${NC} $0 [--url <base_url>] <command> [options]"
    echo ""
    echo -e "${CYAN}Commands:${NC}"
    echo "  generate    Generate new access codes"
    echo "  list        List all access codes"
    echo "  deactivate  Deactivate an access code"
    echo ""
    echo -e "${CYAN}Global options:${NC}"
    echo "  --url <url>   Override base URL (default: $BASE_URL)"
    echo ""
    echo -e "${CYAN}Generate options:${NC}"
    echo "  --count <n>       Number of codes (default: 1, max: 50)"
    echo "  --max-uses <n>    Max uses per code (default: 1, -1 = unlimited)"
    echo "  --expires <date>  Expiration date in ISO 8601 (e.g. 2026-06-01T00:00:00Z)"
    echo "  --prefix <str>    Code prefix (default: CENTUARI)"
    echo ""
    echo -e "${CYAN}Deactivate:${NC}"
    echo "  $0 deactivate <uuid>"
    echo ""
    echo -e "${CYAN}Environment:${NC}"
    echo "  ACCESS_CODE_ADMIN_SECRET   Required. The admin secret token."
    echo ""
    echo -e "${CYAN}Examples:${NC}"
    echo "  $0 generate --count 10"
    echo "  $0 generate --count 5 --prefix PARTNER --max-uses -1"
    echo "  $0 list"
    echo "  $0 deactivate 550e8400-e29b-41d4-a716-446655440000"
    echo "  $0 --url http://localhost:3001 list"
}

# ── Parse global --url flag ─────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --url)
            BASE_URL="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            break
            ;;
    esac
done

COMMAND="${1:-}"
shift || true

if [ -z "$COMMAND" ]; then
    usage
    exit 1
fi

# ── Commands ────────────────────────────────────────────────────────
case "$COMMAND" in
    generate)
        require_secret

        COUNT=1
        MAX_USES=1
        EXPIRES=""
        PREFIX="CENTUARI"

        while [[ $# -gt 0 ]]; do
            case "$1" in
                --count)    COUNT="$2"; shift 2 ;;
                --max-uses) MAX_USES="$2"; shift 2 ;;
                --expires)  EXPIRES="$2"; shift 2 ;;
                --prefix)   PREFIX="$2"; shift 2 ;;
                *) echo -e "${RED}Unknown option: $1${NC}"; exit 1 ;;
            esac
        done

        # Build JSON body
        BODY="{\"count\":$COUNT,\"max_uses\":$MAX_USES,\"prefix\":\"$PREFIX\""
        if [ -n "$EXPIRES" ]; then
            BODY="$BODY,\"expires_at\":\"$EXPIRES\""
        fi
        BODY="$BODY}"

        echo -e "${CYAN}Generating $COUNT access code(s) with prefix $PREFIX...${NC}"

        RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/auth/access-codes/generate" \
            -H "Authorization: Bearer $SECRET" \
            -H "Content-Type: application/json" \
            -d "$BODY")

        HTTP_CODE=$(echo "$RESPONSE" | tail -1)
        BODY_RESPONSE=$(echo "$RESPONSE" | sed '$d')

        if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
            echo -e "${GREEN}Success!${NC}"
            pretty_print "$BODY_RESPONSE"
        else
            echo -e "${RED}Error (HTTP $HTTP_CODE):${NC}"
            pretty_print "$BODY_RESPONSE"
            exit 1
        fi
        ;;

    list)
        require_secret

        echo -e "${CYAN}Fetching access codes...${NC}"

        RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/auth/access-codes" \
            -H "Authorization: Bearer $SECRET")

        HTTP_CODE=$(echo "$RESPONSE" | tail -1)
        BODY_RESPONSE=$(echo "$RESPONSE" | sed '$d')

        if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
            pretty_print "$BODY_RESPONSE"
        else
            echo -e "${RED}Error (HTTP $HTTP_CODE):${NC}"
            pretty_print "$BODY_RESPONSE"
            exit 1
        fi
        ;;

    deactivate)
        require_secret

        CODE_ID="${1:-}"
        if [ -z "$CODE_ID" ]; then
            echo -e "${RED}Error: Please provide the access code UUID.${NC}"
            echo "  $0 deactivate <uuid>"
            exit 1
        fi

        echo -e "${YELLOW}Deactivating access code $CODE_ID...${NC}"

        RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE_URL/auth/access-codes/$CODE_ID/deactivate" \
            -H "Authorization: Bearer $SECRET")

        HTTP_CODE=$(echo "$RESPONSE" | tail -1)
        BODY_RESPONSE=$(echo "$RESPONSE" | sed '$d')

        if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
            echo -e "${GREEN}Deactivated!${NC}"
            pretty_print "$BODY_RESPONSE"
        else
            echo -e "${RED}Error (HTTP $HTTP_CODE):${NC}"
            pretty_print "$BODY_RESPONSE"
            exit 1
        fi
        ;;

    *)
        echo -e "${RED}Unknown command: $COMMAND${NC}"
        usage
        exit 1
        ;;
esac
