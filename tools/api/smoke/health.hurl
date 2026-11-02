# Smoke-тест после деплоя: сервер жив и отвечает версией.
GET {{base_url}}/api/v1/health
HTTP 200
[Asserts]
jsonpath "$.status" == "ok"
jsonpath "$.version" exists
