param([ValidateRange(1, 10080)][int]$Minutes = 60)

$ErrorActionPreference = 'Stop'
$compose = @('compose', '--env-file', (Join-Path $PSScriptRoot '.env.floci'),
    '-f', (Join-Path $PSScriptRoot 'compose.yaml'))
$query = @'
from datetime import datetime, timezone
import json
import sys
import time

import boto3

minutes = int(sys.argv[1])
group = "/aws/lambda/alumnilink-accounts"
logs = boto3.client("logs", endpoint_url="http://127.0.0.1:4566", region_name="us-east-1",
                    aws_access_key_id="test", aws_secret_access_key="test")
pages = logs.get_paginator("filter_log_events")
start = int(time.time() * 1000) - minutes * 60_000
decoder = json.JSONDecoder()
count = 0

print(f"CloudWatch {group}")
for page in pages.paginate(logGroupName=group, startTime=start):
    for event in page.get("events", []):
        message = event["message"]
        _, opening, fields = message.partition('{"service":"profile"')
        if not opening:
            continue
        try:
            record, _ = decoder.raw_decode(opening + fields)
        except ValueError:
            continue
        timestamp = datetime.fromtimestamp(event["timestamp"] / 1000, timezone.utc)
        route = record.get("route") or "(unmatched)"
        print(f"{timestamp.isoformat(timespec='seconds')}  {record['status']} "
              f"{record['method']} {route}  {record['durationMs']} ms  {record['requestId']}")
        count += 1
print(f"{count} Profile requests in the last {minutes} minutes.")
'@

$query | docker @compose exec -T floci python3 - $Minutes
if ($LASTEXITCODE -ne 0) { throw "Could not read the Profile CloudWatch log (exit code $LASTEXITCODE)." }
