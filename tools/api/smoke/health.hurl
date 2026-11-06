# Smoke-тест после деплоя: сервер жив, зависимости доступны, версия на месте.
# Тело — protojson сообщения bebeberloga.v1.HealthStatus (ADR-0017 п. 3), поэтому enum — полным именем.
GET {{base_url}}/api/v1/health
HTTP 200
[Asserts]
jsonpath "$.status" == "HEALTH_STATE_OK"
jsonpath "$.version" exists
jsonpath "$.checks" exists
