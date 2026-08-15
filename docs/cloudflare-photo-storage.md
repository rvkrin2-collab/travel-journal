# Хранилище фотографий Cloudflare

## Публикация Worker

1. Создайте Worker `travel-journal-upload`.
2. Добавьте R2 binding с именем `PHOTOS` на bucket `travel-journal-photos`.
3. Добавьте обычные переменные из `worker/wrangler.toml.example`: `ALLOWED_ORIGIN`, `PUBLIC_BASE_URL`, `GOOGLE_CLIENT_ID`, `ALLOWED_GOOGLE_EMAILS`, `GITHUB_REPOSITORY`.
4. Добавьте encrypted secret `GITHUB_DISPATCH_TOKEN` с fine-grained GitHub token, ограниченным репозиторием журнала и разрешением **Contents: write**.
5. Добавьте encrypted secret `AUTHOR_SESSION_SECRET`. Сгенерируйте значение командой `openssl rand -base64 32`; это не Google-токен и не пароль пользователя.
6. Скопируйте код `worker/src/index.js` в редактор Worker и нажмите **Deploy**.
7. В **Settings → Domains & Routes → Custom Domains** подключите `upload.owntravel.ru`. Не создавайте CNAME на `workers.dev` вручную.
8. Откройте `https://upload.owntravel.ru/health`. Ожидаемый ответ: `{"ok":true,"storage":"r2"}`.

## Что именно добавить в Cloudflare

Откройте **Workers & Pages → travel-journal-upload → Settings → Variables and Secrets** и создайте пять обычных текстовых переменных:

| Variable name | Value |
| --- | --- |
| `ALLOWED_ORIGIN` | `https://owntravel.ru` |
| `PUBLIC_BASE_URL` | `https://photos.owntravel.ru` |
| `GOOGLE_CLIENT_ID` | `1068102637854-ag8pdb54sumdmeabkkduh2co5cnc1eqn.apps.googleusercontent.com` |
| `ALLOWED_GOOGLE_EMAILS` | email вашего Google-аккаунта |
| `GITHUB_REPOSITORY` | `rvkrin2-collab/travel-journal` |

`GITHUB_DISPATCH_TOKEN` добавляется как **Secret**, а не обычная переменная. Он используется Worker только для запуска фонового события `author_trip_submitted` и никогда не возвращается браузеру.

`AUTHOR_SESSION_SECRET` также добавляется как **Secret**. После первоначального входа для Google Photos Picker Worker выдаёт подписанный сеанс автора на 12 часов. Кнопки утверждения фото и preview используют этот сеанс и больше не открывают Google OAuth. Сеанс хранится только в `sessionStorage` текущего браузера и исчезает после завершения сеанса.

Чтобы узнать последнее значение, сначала опубликуйте актуальный Worker и сайт, откройте `/author.html`, нажмите **«Проверить мой Google-аккаунт»**, войдите в Google и скопируйте показанный email. Затем вернитесь в Variables and Secrets, вставьте email в `ALLOWED_GOOGLE_EMAILS` и нажмите **Save and deploy**. Пароль, access token и Client Secret туда вводить нельзя.

Код Worker не нужно набирать вручную: в **Workers & Pages → travel-journal-upload → Edit code** полностью замените содержимое редактора файлом `worker/src/index.js` из репозитория и нажмите **Deploy**. R2 подключается отдельно в **Settings → Bindings → Add binding → R2 bucket**: имя binding — `PHOTOS`, bucket — `travel-journal-photos`.

Endpoint `/upload` принимает только запросы с `Origin: https://owntravel.ru` и действительным Google OAuth access token для настроенного Client ID и Picker scope. Размер изображения ограничен 30 МБ, допустимы JPEG, PNG, WebP, HEIC и HEIF.

Редактор и preview не загружают многомегабайтные оригиналы для каждой карточки. Endpoint `/thumbnail/<key>?w=<width>` использует Cloudflare Image Resizing и длительное кеширование; `/media/<key>` остаётся резервным маршрутом к оригиналу. После обновления этих endpoint необходимо повторно Deploy Worker.

`ALLOWED_GOOGLE_EMAILS` обязателен и содержит email разрешённого Google-аккаунта (несколько адресов разделяются запятыми). Без allowlist Worker отвечает `503`; токен другого Google-аккаунта получает `403`. Проверка `Origin` сама по себе не является авторизацией.

## Модель приватности

- Picker scope даёт приложению доступ только к выбранным в Picker файлам, а не ко всей медиатеке.
- Custom domain R2 делает объект доступным любому, кто знает его точный URL. Поэтому этот bucket предназначен только для фотографий, выбранных для публикации.
- Для приватных черновиков используйте отдельный R2 bucket без public/custom domain и выдавайте файлы через авторизованный Worker.
- Не коммитьте ссылки общедоступных альбомов Google Фото: репозиторий и GitHub Pages могут раскрыть их.
