# Profile and Privacy deployment

From the repository root, with Docker Desktop and Node.js 24 available:

```powershell
pwsh -File .\infra\floci\deploy.ps1
```

The script packages profile-api and its token verifier, updates the existing local Lambda and API Gateway, removes the old identity routes from Ahmed's API, and uploads the combined Search, Contact Requests, Profile and Privacy frontend to S3. The Profile demo uses stand-in Identity and Locations services. Search and Contact Requests need their own configured Search API and compatible login. The original AWS resource name alumnilink-accounts is retained to update the earlier demonstration in place. Runtime configuration now comes from profile-api/.env and uses the restricted Neon database login. Migration owner credentials are excluded from Lambda configuration.

Docker Compose retains the earlier local PostgreSQL volume for the previous demo. The revised Profile Lambda uses the configured Neon DATABASE_URL. Docker volumes preserve Floci resources between restarts.

The runtime uses API Gateway, Lambda, CloudWatch Logs, an IAM log-writing role and S3 hosting. The browser pages are at:

- http://localhost:4566/alumnilink-accounts-web/profile.html
- http://localhost:4566/alumnilink-accounts-web/privacy.html
- http://localhost:4566/_floci/ui

The log group remains /aws/lambda/alumnilink-accounts. Set the team’s TOKEN_SECRET and SERVICE_KEY along with IDENTITY_API_URL and SEARCH_API_URL for the real services. A regular deployment leaves protected operations unavailable until these values are supplied.

For a fresh local Docker environment, create an ignored .env.floci with a random POSTGRES_PASSWORD, using Node's crypto.randomBytes(32).toString('hex'). This password initializes the retained local PostgreSQL service. Configure the separate hosted database in profile-api/.env.

To run deployed integration checks:

```powershell
.\infra\floci\smoke.ps1
```

The check temporarily configures explicit HTTP doubles for the teammate services. It uses synthetic Neon records, verifies the deployed Profile API, checks CloudWatch, and restores the original runtime configuration. It requires the migration owner connection in profile-api/.env for test setup and cleanup. The JSON evidence identifies the use of doubles.

For the real integrated demonstration, Daniel's login page stores the signed token in sessionStorage under token on the same website origin. Profile and Privacy send it in Authorization. Ammar must enforce saved visibility choices in search results and search filters. The three services still require joint testing with the actual teammate code.

Stop the stack while keeping its volumes with:

```powershell
docker compose --env-file .\infra\floci\.env.floci -f .\infra\floci\compose.yaml down
```


## Inspect the browser and Neon together

From Windows PowerShell in the repository root, open Docker Desktop and start the saved stack:

```powershell
docker compose --env-file .\infra\floci\.env.floci -f .\infra\floci\compose.yaml up -d --wait
.\infra\floci\demo.ps1
```

The demo opens a dedicated local Alumni test account in your default browser. It has no session timer. Identity and Locations are explicit test doubles; location always resolves to Demo city, Egypt. Edit the profile, save it, open Privacy and save visibility choices. The separate smoke.ps1 command still runs disposable integration checks.

Keep Docker, this terminal and your internet connection running. The browser renews five-minute signed tokens automatically through a loopback-only endpoint restricted to the local frontend origin and this one synthetic account. Press Enter or Ctrl+C to stop and restore the previous Lambda configuration. Saved demo records are NOT deleted. Run demo.ps1 again to reopen the same account. After closing the browser or signing out, stop and rerun the command to open a new signed-in tab.

In Neon select database neondb on the agreed branch. Inspect alumni_profiles for contact_email, location_id and is_active, skills and alumni_skills for normalized links, and privacy_settings for visibility choices. Persistent demo records stay after the session ends. The account email is printed by demo.ps1. Keep profile-api/.env.persistent-demo.json so future runs reuse that account. Other .env demo runtime files are ignored and must never be committed. If a demo process crashes, rerunning the command recovers the saved Floci configuration once its old process has exited.

In Floci inspect API Gateway and Lambda named alumnilink-accounts, S3 bucket alumnilink-accounts-web, CloudWatch log group /aws/lambda/alumnilink-accounts and the IAM role of the same name. The AWS resource name is retained from the earlier demonstration.


## Reopening and stopping the local demo

Open Docker Desktop first. From the repository root run `.\infra\floci\demo.ps1`. The launcher starts the existing Floci containers if needed. If a persistent demo is already running, it verifies the session and Profile API, then opens a new signed-in tab for the same account instead of reporting a lock error. The process that originally started the demo continues running.

To stop that demo from another PowerShell window, run `.\infra\floci\demo.ps1 -Stop`. This restores the normal local runtime configuration and keeps saved Neon profile and privacy data. Run the normal command again to start a new session using the same account.
