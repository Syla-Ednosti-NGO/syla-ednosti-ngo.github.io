# ГО «Сила Єдності» — сайт організації

Статичний сайт на GitHub Pages: головна сторінка + дві підсистеми.

```
/                      → головна (index.html): два блоки — Членство та Документи
/membership-form/      → форма заяви на вступ (окремий репозиторій)
/documents/            → портал документів + підписання
    index.html         → публічний список опублікованих документів
    sign.html          → сторінка підписанта (#t=<sign_token>)
    admin.html          → адмін-панель (#k=<ADMIN_TOKEN>)  ⚠ секретне посилання
    config.js          → WORKER_URL (адреса API)
    signature.js       → віджет підпису (малювання / фото)
worker/                → Cloudflare Worker (API): D1 + R2
assets/                → спільні стилі (base.css, documents.css, landing.css)
```

## Архітектура

- **Фронтенд** — vanilla HTML/CSS/JS, без бандлера, GitHub Pages.
- **API** — Cloudflare Worker `documents-api` з:
  - **D1** (`documents-db`) — метадані документів і підписів;
  - **R2** (`documents-files`) — самі PDF та зображення підписів.
- **Доступ до адмінки** — секретний токен у фрагменті URL (`admin.html#k=...`),
  який перевіряє Worker (`Authorization: Bearer`). Сам HTML публічний — секретів не містить.

## Локальний запуск

```bash
python -m http.server 8765
# → http://127.0.0.1:8765/
```

(порти 8765 / localhost вже дозволені в CORS воркера)

## Деплой API (одноразове налаштування)

З папки `worker/`:

```bash
# 1. База D1
wrangler d1 create documents-db
#   → скопіюйте database_id у wrangler.toml (поле database_id)

# 2. Таблиці
wrangler d1 execute documents-db --remote --file=./schema.sql

# 3. Сховище R2
wrangler r2 bucket create documents-files

# 4. Секрет адмінки (згенеруйте довгий випадковий рядок і збережіть його!)
wrangler secret put ADMIN_TOKEN
#   цей самий рядок піде у посилання: admin.html#k=<ADMIN_TOKEN>

# 5. Деплой
wrangler deploy
#   → запам'ятайте надрукований URL (напр. https://documents-api.<subdomain>.workers.dev)
```

Після деплою впишіть URL воркера у `documents/config.js` → `WORKER_URL`.

## Деплой фронтенду

GitHub Pages з репозиторію `syla-ednosti-ngo.github.io` (гілка `main`, корінь `/`).
Головна буде доступна на `https://syla-ednosti-ngo.github.io/`.

## Як користуватись

1. **Адмін** відкриває `admin.html#k=<ADMIN_TOKEN>`, тисне «Новий документ»,
   завантажує PDF, обирає кількість підписів (фіксована або відкрита).
2. Копіює **посилання на підпис** і розсилає підписантам.
3. **Підписант** відкриває посилання, переглядає PDF, вводить ПІБ + дату,
   ставить підпис (малюнок / фото), надсилає.
4. Коли набереться потрібна кількість (або адмін натисне «Завершити збір»),
   документ стає «Підписаним». Адмін завантажує **підписаний PDF**
   (оригінал + доданий «Аркуш підписів») і за бажанням публікує його на порталі.
