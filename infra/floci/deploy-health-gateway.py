"""Provision the optional Profile health gateway inside the local Floci container."""

import boto3


def ensure_resource(gateway, api_id, path, parent_id, path_part):
    resources = gateway.get_resources(restApiId=api_id)["items"]
    for resource in resources:
        if resource["path"] == path:
            return resource["id"]
    return gateway.create_resource(
        restApiId=api_id, parentId=parent_id, pathPart=path_part
    )["id"]


def main():
    region = "us-east-1"
    settings = {
        "endpoint_url": "http://127.0.0.1:4566",
        "region_name": region,
        "aws_access_key_id": "test",
        "aws_secret_access_key": "test",
    }
    gateway = boto3.client("apigateway", **settings)
    functions = boto3.client("lambda", **settings)
    function_name = "alumnilink-accounts"
    function_arn = functions.get_function_configuration(FunctionName=function_name)["FunctionArn"]
    account = function_arn.split(":")[4]
    gateway_name = "alumnilink-profile-health"
    stage = "local"
    path = "/api/health"

    apis = gateway.get_rest_apis(limit=500).get("items", [])
    api = next((item for item in apis if item["name"] == gateway_name), None)
    if api is None:
        api = gateway.create_rest_api(
            name=gateway_name,
            description="Local REST health check for the AlumniLink Profile Lambda.",
        )
    api_id = api["id"]

    resources = gateway.get_resources(restApiId=api_id)["items"]
    root_id = next(resource["id"] for resource in resources if resource["path"] == "/")
    api_resource_id = ensure_resource(gateway, api_id, "/api", root_id, "api")
    health_id = ensure_resource(gateway, api_id, path, api_resource_id, "health")
    method = {"restApiId": api_id, "resourceId": health_id, "httpMethod": "GET"}
    try:
        gateway.get_method(**method)
    except gateway.exceptions.NotFoundException:
        gateway.put_method(**method, authorizationType="NONE")

    try:
        functions.add_permission(
            FunctionName=function_name,
            StatementId=f"rest-health-{api_id}",
            Action="lambda:InvokeFunction",
            Principal="apigateway.amazonaws.com",
            SourceArn=f"arn:aws:execute-api:{region}:{account}:{api_id}/{stage}/GET{path}",
        )
    except functions.exceptions.ResourceConflictException:
        pass

    expected = {
        "type": "AWS_PROXY",
        "httpMethod": "POST",
        "uri": f"arn:aws:apigateway:{region}:lambda:path/2015-03-31/functions/{function_arn}/invocations",
    }
    try:
        integration = gateway.get_integration(**method)
    except gateway.exceptions.NotFoundException:
        integration = {}
    integration_changed = any(integration.get(key) != value for key, value in expected.items())
    if integration_changed:
        gateway.put_integration(
            **method, type=expected["type"],
            integrationHttpMethod=expected["httpMethod"], uri=expected["uri"],
        )

    stages = gateway.get_stages(restApiId=api_id).get("item", [])
    if integration_changed or not any(item["stageName"] == stage for item in stages):
        gateway.create_deployment(restApiId=api_id, stageName=stage, description="Profile health endpoint")

    print(f"REST API Gateway  {gateway_name} ({api_id})")
    print(f"REST API health   http://{api_id}.execute-api.localhost.floci.io:4566/{stage}{path}")


if __name__ == "__main__":
    main()
