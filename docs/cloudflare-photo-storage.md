# Хранилище фотографий Cloudflare

## Публикация Worker

1. Создайте Worker `travel-journal-upload`.
2. Добавьте R2 binding с именем `PHOTOS` на bucket `travel-journal-photos`.
3. Добавьте обычные переменные из `worker/wrangler.toml.example`: `ALLOWED_ORIGIN`, `PUBLIC_BASE_URL`, `GOOGLE_CLIENT_ID`, `ALLOWED_GOOGLE_USER_IDS`.
4. Скопируйте код `worker/src/index.js` в редактор Worker и нажмите **Deploy**.
5. В **Settings → Domains & Routes → Custom Domains** подключите `upload.owntravel.ru`. Не создавайте CNAME на `workers.dev` вручную.
6. Откройте `https://upload.owntravel.ru/health`. Ожидаемый ответ: `{"ok":true,"storage":"r2"}`.

Endpoint `/upload` принимает только запросы с `Origin: https://owntravel.ru` и действительным Google OAuth access token для настроенного Client ID и Picker scope. Размер изображения ограничен 30 МБ, допустимы JPEG, PNG, WebP, HEIC и HEIF.

`ALLOWED_GOOGLE_USER_IDS` обязателен и содержит Google user ID разрешённого автора (несколько ID разделяются запятыми). Без allowlist Worker отвечает `503`; токен другого Google-аккаунта получает `403`. Проверка `Origin` сама по себе не является авторизацией.

## Модель приватности

- Picker scope даёт приложению доступ только к выбранным в Picker файлам, а не ко всей медиатеке.
- Custom domain R2 делает объект доступным любому, кто знает его точный URL. Поэтому этот bucket предназначен только для фотографий, выбранных для публикации.
- Для приватных черновиков используйте отдельный R2 bucket без public/custom domain и выдавайте файлы через авторизованный Worker.
- Не коммитьте ссылки общедоступных альбомов Google Фото: репозиторий и GitHub Pages могут раскрыть их.
