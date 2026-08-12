# Хранилище фотографий Cloudflare

## Публикация Worker

1. Создайте Worker `travel-journal-upload`.
2. Добавьте R2 binding с именем `PHOTOS` на bucket `travel-journal-photos`.
3. Добавьте обычные переменные из `worker/wrangler.toml.example`: `ALLOWED_ORIGIN`, `PUBLIC_BASE_URL`, `GOOGLE_CLIENT_ID`.
4. Скопируйте код `worker/src/index.js` в редактор Worker и нажмите **Deploy**.
5. В **Settings → Domains & Routes → Custom Domains** подключите `upload.owntravel.ru`. Не создавайте CNAME на `workers.dev` вручную.
6. Откройте `https://upload.owntravel.ru/health`. Ожидаемый ответ: `{"ok":true,"storage":"r2"}`.

Endpoint `/upload` принимает только запросы с `Origin: https://owntravel.ru` и действительным Google OAuth access token для настроенного Client ID и Picker scope. Размер изображения ограничен 30 МБ, допустимы JPEG, PNG, WebP, HEIC и HEIF.

Endpoint `POST /import` принимает выбранные через Google Photos Picker элементы, скачивает оригиналы с разрешённого домена Google и сохраняет их в тот же R2 bucket. За один запрос можно импортировать до 100 фотографий.
