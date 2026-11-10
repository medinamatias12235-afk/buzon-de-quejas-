/**
 * Cloudflare Pages Function — /api/quejas
 *
 * GET  /api/quejas  → { quejas: [...] } ordenadas por prioridad (alta → baja) y fecha desc.
 * POST /api/quejas  → { texto, categoria } → guarda la queja y devuelve { ok, id, prioridad }.
 *
 * La prioridad la decide Workers AI (binding env.AI, modelo llama-3.1-8b-instruct).
 * Si la IA falla, no está configurada o responde algo inesperado, se usa un
 * clasificador por palabras clave. Máximo 500 caracteres por queja.
 */

const MODELO = '@cf/meta/llama-3.1-8b-instruct';
const MAX_TEXTO = 500;
const MAX_CATEGORIA = 60;

// Se comparan sobre texto normalizado (minúsculas y sin acentos).
const RE_ALTA =
  /\b(urgente|urgencia|emergencia|peligro|peligroso|peligrosa|grave|gravedad|accidente|herido|herida|incendio|fuga|robo|asalto|inseguridad|violencia|agresion|acoso|amenaza|estafa|fraude|discriminacion|abuso)\b/;
const RE_MEDIA =
  /\b(falla|fallo|error|problema|demora|retraso|molestia|molesto|cobro|defectuoso|roto|rota|reclamo|insatisfecho|incumplimiento|sucio|ruido|mal|malo|mala)\b/;

function json(datos, estado = 200) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function errorSinDB() {
  return json(
    {
      error:
        'Falta el binding de base de datos D1 (env.DB). Configúralo en Cloudflare Pages → Settings → Functions → D1 database bindings con el nombre de variable "DB".',
    },
    500,
  );
}

function normalizar(texto) {
  return String(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Clasificador de respaldo, sin IA. */
function prioridadPorPalabras(texto) {
  const t = normalizar(texto);
  if (RE_ALTA.test(t)) return 'alta';
  if (RE_MEDIA.test(t)) return 'media';
  return 'baja';
}

/**
 * Pide la prioridad a Workers AI.
 * Devuelve 'alta' | 'media' | 'baja' o null si no se pudo determinar.
 */
async function prioridadConIA(env, texto, categoria) {
  if (!env || !env.AI || typeof env.AI.run !== 'function') return null;

  const respuesta = await env.AI.run(MODELO, {
    messages: [
      {
        role: 'system',
        content:
          'Clasificas quejas por prioridad. Responde ÚNICAMENTE con una palabra: "alta", "media" o "baja". Sin explicaciones, sin puntuación, sin nada más.',
      },
      {
        role: 'user',
        content: `Categoría: ${categoria}\nQueja: ${texto}\n\nPrioridad:`,
      },
    ],
    max_tokens: 4,
    temperature: 0,
  });

  const crudo = String(
    respuesta?.response ?? respuesta?.result?.response ?? '',
  ).toLowerCase();

  const coincidencia = crudo.match(/\b(alta|media|baja)\b/);
  return coincidencia ? coincidencia[1] : null;
}

function validarTexto(valor) {
  if (typeof valor !== 'string') return { error: 'El campo "texto" es obligatorio.' };
  const texto = valor.trim();
  if (texto.length < 5) return { error: 'La queja debe tener al menos 5 caracteres.' };
  if (texto.length > MAX_TEXTO) {
    return { error: `La queja no puede superar los ${MAX_TEXTO} caracteres.` };
  }
  return { texto };
}

function validarCategoria(valor) {
  if (typeof valor !== 'string') return 'Otro';
  const categoria = valor.trim().slice(0, MAX_CATEGORIA);
  return categoria || 'Otro';
}

export async function onRequestPost({ request, env }) {
  if (!env || !env.DB) return errorSinDB();

  let cuerpo;
  try {
    cuerpo = await request.json();
  } catch (_) {
    return json({ error: 'El cuerpo de la petición debe ser JSON válido.' }, 400);
  }

  const validacion = validarTexto(cuerpo?.texto);
  if (validacion.error) return json({ error: validacion.error }, 400);

  const { texto } = validacion;
  const categoria = validarCategoria(cuerpo?.categoria);

  // 1) Intentar con IA. 2) Si falla, palabras clave.
  let prioridad = null;
  try {
    prioridad = await prioridadConIA(env, texto, categoria);
  } catch (error) {
    console.error('Workers AI no disponible, usando palabras clave:', error);
    prioridad = null;
  }

  if (prioridad !== 'alta' && prioridad !== 'media' && prioridad !== 'baja') {
    prioridad = prioridadPorPalabras(texto);
  }

  try {
    const resultado = await env.DB.prepare(
      'INSERT INTO quejas (texto, categoria, prioridad) VALUES (?, ?, ?)',
    )
      .bind(texto, categoria, prioridad)
      .run();

    return json(
      {
        ok: true,
        id: resultado?.meta?.last_row_id ?? null,
        prioridad,
      },
      201,
    );
  } catch (error) {
    console.error('Error al guardar en D1:', error);
    return json(
      {
        error:
          'No se pudo guardar la queja en la base de datos. Revisa el binding D1 (env.DB) y que la tabla "quejas" exista.',
      },
      500,
    );
  }
}

export async function onRequestGet({ env }) {
  if (!env || !env.DB) return errorSinDB();

  try {
    const resultado = await env.DB.prepare(
      `SELECT id, texto, categoria, prioridad, creada
         FROM quejas
        ORDER BY CASE prioridad
                   WHEN 'alta'  THEN 0
                   WHEN 'media' THEN 1
                   ELSE 2
                 END,
                 creada DESC
        LIMIT 500`,
    ).all();

    return json({ quejas: resultado?.results ?? [] });
  } catch (error) {
    console.error('Error al leer de D1:', error);
    return json(
      {
        error:
          'No se pudieron leer las quejas. Revisa el binding D1 (env.DB) y que la tabla "quejas" exista.',
      },
      500,
    );
  }
}
