# AirForce backend (AWS SAM)

Serverless backend for the AirForce app: an HTTP API with two Lambda functions (Python 3.12) and one
DynamoDB cache table. Region `us-east-1`, stack `airforce-backend`.

```
infra/
  template.yaml              HTTP API, DynamoDB table, 2 functions, log groups (7 days)
  samconfig.toml             stack name, region, capabilities, AllowedOrigins override
  functions/conditions/      GET /conditions  (standard library + runtime boto3)
  functions/explain/         POST /explain    (strands-agents on Bedrock)
  events/                    sample Lambda events + a raw /explain body for curl
  tests/                     pytest suite (no AWS calls: HTTP, DynamoDB and the model are mocked)
```

## Endpoints

### `GET /conditions?lat=..&lon=..`

Current outdoor PM2.5 (Open-Meteo Air Quality) and weather (Open-Meteo Forecast) for a location.

- `lat` must be in −90..90 and `lon` in −180..180, otherwise `400 { "error": true, "reason": ... }`.
  `latitude`/`longitude` are accepted too, so the frontend's Open-Meteo provider can use
  `<ApiUrl>/conditions` as its `baseUrl` unchanged.
- Coordinates are rounded to 2 decimals (~1 km) and cached for 30 minutes under `cond#<lat>#<lon>`.
- Both Open-Meteo calls have an 8 s timeout. If the weather call fails the response still has PM2.5
  with `"weather": null` (and isn't cached). If the PM2.5 call fails: `502 { "error": true, "reason": ... }`.

```json
{
  "current": { "time": "2026-10-11T07:00", "pm2_5": 143.2 },
  "weather": { "time": "2026-10-11T07:15", "temperatureC": 29.1, "windSpeedMs": 2.3, "windDirDeg": 310 },
  "location": { "lat": 28.61, "lon": 77.21 },
  "source": "open-meteo",
  "cached": false
}
```

`time` values are GMT, as Open-Meteo returns them; `windDirDeg` is the meteorological "from" direction.

### `POST /explain`

Turns one ranked action (from `rankActions`) into 2–3 plain sentences for a non-technical household,
using a Strands Agent on Amazon Bedrock (`BedrockModelId`, default `us.amazon.nova-lite-v1:0`,
temperature 0.2, max 250 tokens).

- Body: see `events/explain-body.json`. The schema is checked strictly (unknown fields, wrong
  types or a body over 8 KB give `400`).
- Cached for 7 days under `explain#v1#<sha256 of the normalized JSON body>`.
- **Grounding check:** every number in the answer must be derivable from the input (input numbers,
  `|fraction| × 100`, per-room % changes and before − after drops, each rounded to 0 or 1 decimals;
  counts 1–3 are allowed). On failure the model is asked once more with a stricter reminder; if that
  fails too the response is `{ "text": null, "reason": "ungrounded" }` and nothing is cached.
- Response: `{ "text": "...", "model": "us.amazon.nova-lite-v1:0", "cached": false }`.
- Bedrock errors or timeouts: `502 { "error": true, "reason": ... }`.

Both routes are throttled at 5 requests/s (burst 10) and CORS is limited to `AllowedOrigins`.

## Prerequisites

- AWS SAM CLI and Python 3.12 on your PATH.
- AWS credentials for the target account (`aws configure` or `aws login`).
- Bedrock model access for Amazon Nova Lite in `us-east-1` (see "AWS console" below).

## Test locally

```bash
cd infra
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest
```

## Build and deploy

```bash
cd infra
sam validate --lint
sam build
sam deploy            # uses samconfig.toml (stack airforce-backend, us-east-1, CAPABILITY_IAM)
# or, the first time / to change settings interactively:
sam deploy --guided
```

Override the parameters at deploy time if needed:

```bash
sam deploy --parameter-overrides \
  'AllowedOrigins="https://main.d2iwbt8w1yhn6o.amplifyapp.com,http://localhost:3000"' \
  'BedrockModelId="us.amazon.nova-lite-v1:0"'
```

Get the API URL:

```bash
aws cloudformation describe-stacks --stack-name airforce-backend --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text
```

## Try it with curl

```bash
API=$(aws cloudformation describe-stacks --stack-name airforce-backend --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)

curl -s "$API/conditions?lat=28.6139&lon=77.2090"
curl -s "$API/conditions?lat=200&lon=0"                 # 400

curl -s -X POST "$API/explain" -H 'content-type: application/json' \
  --data-binary @events/explain-body.json              # run again: "cached": true

# CORS preflight
curl -si -X OPTIONS "$API/explain" -H 'Origin: http://localhost:3000' \
  -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type'
```

## Logs

```bash
sam logs --stack-name airforce-backend --tail
sam logs --stack-name airforce-backend -n ExplainFunction --tail
```

Each request logs one JSON line (route, status, cache hit/miss, latency); coordinates and request
bodies are not logged. Log groups keep 7 days.

## Delete the stack

```bash
sam delete --stack-name airforce-backend --region us-east-1
```

This removes the API, functions, log groups and the cache table (cached data only).
