# FPL Stats — backend (CDK)

AWS CDK (TypeScript) app that defines the backend: API Gateway, Python Lambda handlers, DynamoDB, EventBridge, and (soon) S3. Lambda source lives under `lambdas/` and is bundled at deploy time.

## First-time AWS setup

One-time steps per AWS account/region before any `cdk deploy`.

### 1. Verify AWS CLI auth

```bash
aws sts get-caller-identity
```

Should print your account ID and IAM user/role. If this fails, run `aws configure` (or your SSO login flow) first.

### 2. (Recommended) Set us-east-1 as default region

```bash
aws configure set region us-east-1
```

This project targets `us-east-1`. Setting the default lets you drop `--region` from later AWS CLI calls.

### 3. Bootstrap CDK

CDK needs a support stack named `CDKToolkit` in each (account, region) combination before it can deploy anything. Bootstrap provisions an S3 bucket for asset staging, an ECR repo (for container images if needed), and a few IAM roles — free-tier friendly for our usage.

Use the account ID from step 1:

```bash
cd backend
npx cdk bootstrap aws://<your-account-id>/us-east-1
```

Takes about a minute. You should see `✅  Environment aws://<account>/us-east-1 bootstrapped.` at the end.

### 4. Verify the CDKToolkit stack exists

```bash
aws cloudformation describe-stacks \
  --stack-name CDKToolkit \
  --region us-east-1 \
  --query 'Stacks[0].StackStatus' \
  --output text
```

Should print `CREATE_COMPLETE`.

## Useful commands

- `npm run build` — compile TypeScript to JS
- `npm run watch` — compile on change
- `npm run test` — jest unit tests (CDK stack assertions)
- `npx cdk synth` — render CloudFormation locally (no deploy)
- `npx cdk diff` — diff deployed vs local
- `npm run deploy` — deploy and write stack outputs to `.deploy-outputs.json` (gitignored). Requires bootstrap (above) and Docker running locally for Python Lambda bundling.

## Deploy and verify

1. Confirm Docker is running: `docker info` should print server info without errors.
2. Run `npm run deploy` from `backend/`. On first deploy CDK will print an IAM-changes summary and ask you to confirm (`y`). Expect ~2–4 minutes.
3. Grab the API base URL from `.deploy-outputs.json` (or from the `FplStatsStack.ApiBaseUrl` key in the CDK deploy output):

   ```bash
   API_URL=$(jq -r '.FplStatsStack.ApiBaseUrl' .deploy-outputs.json)
   curl -i "$API_URL/health"
   ```

4. Expect `HTTP/2 200` and a JSON body like `{"ok":true,"time":"2026-04-21T17:30:00.000000+00:00"}`.

## Lambda handlers

Lambda handlers are Python, one directory per function under `backend/lambdas/<name>/`. See root `CLAUDE.md` for the full layout and per-Lambda dev commands.
