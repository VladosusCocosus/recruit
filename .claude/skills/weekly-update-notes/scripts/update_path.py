#!/usr/bin/env python3
"""Print the updates/ folder for an ISO week, plus the dates that week covers.

Usage:
    python3 update_path.py            # the week containing today
    python3 update_path.py 2026-09-05 # the week containing that date

The year and month come from the week's THURSDAY, not from today. ISO already
defines a week's year by its Thursday, and extending that to the month keeps a
week that straddles a month boundary in one folder no matter which day you run
this. Week 36 of 2026 runs Mon 31 Aug to Sun 6 Sep; its Thursday is 3 Sep, so it
files under 2026/09 whether you write the note on the Monday or the Sunday.
"""
import datetime
import sys


def week_folder(day: datetime.date) -> dict:
    monday = day - datetime.timedelta(days=day.weekday())
    sunday = monday + datetime.timedelta(days=6)
    thursday = monday + datetime.timedelta(days=3)
    iso_year, iso_week, _ = day.isocalendar()
    return {
        "path": f"updates/{thursday.year}/{thursday.month:02d}/W{iso_week:02d}",
        "iso_year": iso_year,
        "iso_week": iso_week,
        "monday": monday,
        "sunday": sunday,
    }


def main() -> int:
    if len(sys.argv) > 2:
        print(__doc__, file=sys.stderr)
        return 2
    if len(sys.argv) == 2:
        try:
            day = datetime.date.fromisoformat(sys.argv[1])
        except ValueError:
            print(f"not an ISO date: {sys.argv[1]}", file=sys.stderr)
            return 2
    else:
        day = datetime.date.today()

    w = week_folder(day)
    print(w["path"])
    print(f"week:  {w['iso_year']}-W{w['iso_week']:02d}")
    print(f"range: {w['monday']} to {w['sunday']}")
    print(f"since: --since={w['monday']} --until={w['sunday'] + datetime.timedelta(days=1)}")
    print(f"title: week of {w['monday'].strftime('%-d %B %Y')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
