#!/usr/bin/env python3
"""Export a Google Sheets tab to CSV using a Google OAuth access token."""
import csv
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def get_json(url, token):
    request = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Google Sheets API returned HTTP {exc.code}: {detail}") from exc


def main():
    if len(sys.argv) != 4:
        raise SystemExit("Usage: sheet_csv.py SHEET_ID GID OUTPUT.csv")
    sheet_id, gid, output = sys.argv[1:]
    token = os.environ.get("GOOGLE_TOKEN", "")
    if not token:
        raise SystemExit("GOOGLE_TOKEN is missing")

    base = "https://sheets.googleapis.com/v4/spreadsheets/"
    metadata = get_json(
        base + urllib.parse.quote(sheet_id, safe="") +
        "?fields=" + urllib.parse.quote("sheets.properties(sheetId,title)"),
        token,
    )
    sheet = next(
        (s["properties"] for s in metadata.get("sheets", [])
         if str(s.get("properties", {}).get("sheetId")) == str(gid)),
        None,
    )
    if not sheet:
        available = [
            f'{s.get("properties", {}).get("title")} (gid {s.get("properties", {}).get("sheetId")})'
            for s in metadata.get("sheets", [])
        ]
        raise SystemExit(f"No sheet tab with gid {gid}. Available tabs: {', '.join(available)}")

    title = sheet["title"].replace("'", "''")
    quoted_range = f"'{title}'"
    params = urllib.parse.urlencode({"valueRenderOption": "FORMATTED_VALUE"})
    url = (
        base + urllib.parse.quote(sheet_id, safe="") +
        "/values/" + urllib.parse.quote(quoted_range, safe="") + "?" + params
    )
    data = get_json(url, token)
    values = data.get("values", [])
    if not values:
        raise SystemExit(f"Sheet tab {title!r} is empty")

    with open(output, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerows(values)
    print(f"Exported {len(values) - 1} data rows from tab {title!r} to {output}")


if __name__ == "__main__":
    main()
