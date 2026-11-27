import base64
import json
import sys
from pathlib import Path

import boto3

name = "alumnilink-accounts"
region = "us-east-1"
account = "000000000000"
endpoint = "http://127.0.0.1:4566"
origin = "http://localhost:4566"
bucket = "alumnilink-accounts-web"
log_group = f"/aws/lambda/{name}"

routes = [
    "GET /api/health",
    "POST /api/profiles",
    "GET /api/profiles/me",
    "PATCH /api/profiles/me",
    "PATCH /api/profiles/me/status",
    "GET /api/profiles/me/skills",
    "PUT /api/profiles/me/skills",
    "GET /api/profiles/me/privacy",
    "PATCH /api/profiles/me/privacy",
    "GET /internal/profiles/{id}/contact",
]

session = boto3.Session(aws_access_key_id="test", aws_secret_access_key="test", region_name=region)


def client(service):
    return session.client(service, endpoint_url=endpoint)


def deploy_role():
    iam = client("iam")
    logs = client("logs")
    try:
        logs.create_log_group(logGroupName=log_group)
    except logs.exceptions.ResourceAlreadyExistsException:
        pass
    logs.put_retention_policy(logGroupName=log_group, retentionInDays=7)

    trust = {
        "Version": "2012-10-17",
        "Statement": [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"},
                       "Action": "sts:AssumeRole"}],
    }
    try:
        role = iam.create_role(RoleName=name, AssumeRolePolicyDocument=json.dumps(trust))["Role"]
    except iam.exceptions.EntityAlreadyExistsException:
        role = iam.get_role(RoleName=name)["Role"]
    policy = {
        "Version": "2012-10-17",
        "Statement": [{"Effect": "Allow", "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
                       "Resource": f"arn:aws:logs:{region}:{account}:log-group:{log_group}:*"}],
    }
    iam.put_role_policy(RoleName=name, PolicyName="write-accounts-logs", PolicyDocument=json.dumps(policy))
    return role["Arn"]


def deploy_lambda(role, settings):
    functions = client("lambda")
    package = Path("/tmp/alumnilink-accounts.zip").read_bytes()
    configuration = dict(
        Runtime="nodejs24.x", Role=role, Handler="profile-api/lambda.handler", Timeout=20,
        MemorySize=256, Environment={"Variables": settings},
    )
    try:
        functions.get_function_configuration(FunctionName=name)
    except functions.exceptions.ResourceNotFoundException:
        functions.create_function(FunctionName=name, Code={"ZipFile": package}, **configuration)
    else:
        functions.update_function_code(FunctionName=name, ZipFile=package)
        functions.get_waiter("function_updated_v2").wait(FunctionName=name)
        functions.update_function_configuration(FunctionName=name, **configuration)
        functions.get_waiter("function_updated_v2").wait(FunctionName=name)
    functions.get_waiter("function_active_v2").wait(FunctionName=name)
    return functions


def deploy_gateway(functions):
    gateway = client("apigatewayv2")
    cors = dict(AllowOrigins=[origin], AllowMethods=["GET", "POST", "PATCH", "PUT", "OPTIONS"],
                AllowHeaders=["authorization", "content-type"], ExposeHeaders=["x-request-id"])
    apis = gateway.get_apis()["Items"]
    api = next((resource for resource in apis if resource["Name"] == name), None)
    if api:
        api_id = api["ApiId"]
        gateway.update_api(ApiId=api_id, CorsConfiguration=cors)
    else:
        api_id = gateway.create_api(Name=name, ProtocolType="HTTP", CorsConfiguration=cors)["ApiId"]

    function_arn = f"arn:aws:lambda:{region}:{account}:function:{name}"
    integrations = gateway.get_integrations(ApiId=api_id)["Items"]
    integration = next((item for item in integrations if item.get("IntegrationUri") == function_arn), None)
    if not integration:
        integration = gateway.create_integration(
            ApiId=api_id, IntegrationType="AWS_PROXY", IntegrationUri=function_arn, PayloadFormatVersion="2.0")
    target = "integrations/" + integration["IntegrationId"]

    existing = {route["RouteKey"]: route for route in gateway.get_routes(ApiId=api_id)["Items"]}
    for key, old_route in existing.items():
        if key not in routes:
            gateway.delete_route(ApiId=api_id, RouteId=old_route["RouteId"])
    for key in routes:
        if key not in existing:
            gateway.create_route(ApiId=api_id, RouteKey=key, Target=target)
        elif existing[key]["Target"] != target:
            gateway.update_route(ApiId=api_id, RouteId=existing[key]["RouteId"], Target=target)

    try:
        functions.add_permission(
            FunctionName=name, StatementId=f"gateway-{api_id}", Action="lambda:InvokeFunction",
            Principal="apigateway.amazonaws.com",
            SourceArn=f"arn:aws:execute-api:{region}:{account}:{api_id}/*/*/*")
    except functions.exceptions.ResourceConflictException:
        pass

    if not any(stage["StageName"] == "$default" for stage in gateway.get_stages(ApiId=api_id)["Items"]):
        gateway.create_stage(ApiId=api_id, StageName="$default", AutoDeploy=True)
    return f"http://{api_id}.execute-api.localhost.floci.io:4566"


def deploy_frontend(api_url):
    s3 = client("s3")
    if not any(item["Name"] == bucket for item in s3.list_buckets().get("Buckets", [])):
        s3.create_bucket(Bucket=bucket)
    s3.put_bucket_website(Bucket=bucket, WebsiteConfiguration={"IndexDocument": {"Suffix": "index.html"}})
    assets = {
        "index.html": "text/html", "requests.html": "text/html",
        "profile.html": "text/html", "privacy.html": "text/html",
        "alumnilink-badge.png": "image/png",
        "css/styles.css": "text/css", "css/profile.css": "text/css",
        "js/config.js": "text/javascript", "js/api.js": "text/javascript",
        "js/search.js": "text/javascript", "js/requests.js": "text/javascript",
        "js/profile-client.js": "text/javascript", "js/profile.js": "text/javascript",
        "js/privacy.js": "text/javascript",
    }
    for asset, media_type in assets.items():
        s3.put_object(Bucket=bucket, Key=asset, ContentType=media_type,
                      Body=Path("/tmp/alumnilink-frontend", asset).read_bytes(), CacheControl="no-cache")
    config = "window.ALUMNILINK = " + json.dumps({"PROFILE_API_URL": api_url, "LOGIN_URL": ""}) + ";\n"
    s3.put_object(Bucket=bucket, Key="js/profile-config.js", ContentType="text/javascript",
                  Body=config.encode(), CacheControl="no-cache")
    for asset in ("app.js", "config.js", "styles.css"):
        s3.delete_object(Bucket=bucket, Key=asset)


def main():
    settings = json.load(sys.stdin)
    role = deploy_role()
    functions = deploy_lambda(role, settings)
    api_url = deploy_gateway(functions)
    deploy_frontend(api_url)
    print(f"API Gateway  {api_url}")
    print(f"Browser app  {origin}/{bucket}/profile.html")
    print(f"CloudWatch   {log_group}")
    print(f"Floci Dash   {origin}/_floci/ui")


if __name__ == "__main__":
    main()
