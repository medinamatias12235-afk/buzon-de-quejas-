# Buzón de quejas — Cloudflare Pages + D1 + Workers AI

! funciona

Aplicación mínima de quejas anónimas:

- **`/index.html`** — formulario (texto + categoría, sin pedir nombre). Máx. 500 caracteres.
- **`/panel.html`** — lista las quejas por prioridad (alta → media → baja) y por fecha.
- **`/api/quejas`** — Pages Function: `POST` guarda (D1) y clasifica con Workers AI; `GET` devuelve JSON.

---

## Estructura

```

.
├── index.html
├── panel.html
├── schema.sql
├── functions/
│   └── api/
│       └── quejas.js
└── README.md

```

---

## 1. Requisitos

- Cuenta de Cloudflare con **Pages**, **D1** y **Workers AI** habilitados.
- Node.js 18+ y Wrangler:

```bash
npm install -g wrangler
wrangler login
```

---

## 2. Crear la base de datos D1

```
wrangler d1 create quejas-db
```

Copia el `database_id` que imprime el comando (lo necesitarás si usas `wrangler.toml`).

Crea la tabla:

```
wrangler d1 execute quejas-db --remote --file=./schema.sql
```

> Para desarrollo local usa `--local` en lugar de `--remote`.

---

## 3. Desplegar en Cloudflare Pages

### Opción A — Desde el panel (Git)

1. Sube este proyecto a un repositorio de GitHub/GitLab.
2. En Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Configuración del build:

- **Framework preset:** `None`
- **Build command:** *(vacío)*
- **Build output directory:** `/` (la raíz del repo)
4. **Deploy**. Pages detecta automáticamente la carpeta `functions/`.

### Opción B — Subida directa con Wrangler

```
wrangler pages deploy . --project-name=buzon-quejas
```

---

## 4. Configurar los bindings (obligatorio)

En el proyecto de Pages → **Settings** → **Functions** → **Bindings**:

| Tipo ↕▾ | Nombre de variable ↕▾ | Valor ↕▾ |
|---|---|---|
| −**D1 database** | `DB` | `quejas-db` |
| −**Workers AI** | `AI` | *(sin configuración)* |
⚙

- **`DB`** es obligatorio. Si falta, la API responde con un error JSON claro.
- **`AI`** es opcional: si no lo configuras (o la IA falla), la prioridad se calcula
por palabras clave (`urgente`, `grave`, `robo`, `falla`, `demora`, …).

Después de añadir los bindings, **vuelve a desplegar** (Deployments → Retry deployment)
para que la nueva versión los reciba.

---

## 5. Desarrollo local

```
# 1. Crear la tabla en la D1 local
wrangler d1 execute quejas-db --local --file=./schema.sql

# 2. Servir el sitio con los bindings
wrangler pages dev . --d1 DB=quejas-db --ai AI
```

Abre `http://localhost:8788`.

> Si tu versión de Wrangler no admite `--ai`, ejecuta sin ese flag: la app seguirá
> funcionando y usará el clasificador por palabras clave. Para probar la IA real,
> despliega en Cloudflare o usa `--remote`.

---

## 6. Cómo funciona la clasificación

1. El `POST` valida el texto (5–500 caracteres) y la categoría.
2. Se llama a Workers AI con el modelo `@cf/meta/llama-3.1-8b-instruct`,
pidiendo **una sola palabra**: `alta`, `media` o `baja` (`max_tokens: 4`, `temperature: 0`).
3. Se extrae la primera coincidencia con `\b(alta|media|baja)\b`.
4. Si no hay binding `AI`, la llamada lanza una excepción o la respuesta no contiene
una prioridad válida → se usa el clasificador por palabras clave (texto normalizado
sin acentos, con límites de palabra).
5. Se inserta en D1 y se devuelve `{ ok, id, prioridad }`.

**Palabras clave de prioridad alta:** urgente, emergencia, peligro, grave, accidente,
herido, incendio, fuga, robo, asalto, inseguridad, violencia, agresión, acoso, amenaza,
estafa, fraude, discriminación, abuso.

**Prioridad media:** falla, error, problema, demora, retraso, molestia, cobro,
defectuoso, roto, reclamo, insatisfecho, incumplimiento, sucio, ruido, mal.

Todo lo demás → **baja**.

---

## 7. Seguridad y límites

- **500 caracteres** por queja: se limita en el `maxlength` del formulario, en el
servidor y con un `CHECK` en la tabla.
- **Escape de HTML:** el panel construye el DOM con `textContent`, nunca con
`innerHTML`, así que el texto de las quejas se muestra escapado.
- **Sin autenticación:** el panel es público. Si necesitas restringirlo, añade
Cloudflare Access sobre la ruta `/panel.html` o protege la `GET` con un token.
- La `GET` devuelve como máximo 500 quejas.
- No se recogen nombres ni datos personales.

---

## 8. Endpoints

### `POST /api/quejas`

```
{ "texto": "La luz del pasillo lleva una semana rota y hay riesgo de caída", "categoria": "Instalaciones" }
```

Respuesta `201`:

```
{ "ok": true, "id": 12, "prioridad": "alta" }
```

Errores: `400` (validación) y `500` (sin binding D1 o fallo de base de datos),
siempre con `{ "error": "mensaje claro" }`.

### `GET /api/quejas`

```
{
  "quejas": [
    { "id": 12, "texto": "…", "categoria": "Instalaciones", "prioridad": "alta", "creada": "2026-10-11T12:48:29.123Z" }
  ]
}
```

Orden: prioridad (alta → media → baja) y luego `creada` descendente.

