-- Esquema de la base de datos D1 para el buzón de quejas.
-- Ejecutar con:
--   npx wrangler d1 execute quejas-db --remote --file=./schema.sql
--   npx wrangler d1 execute quejas-db --local  --file=./schema.sql

DROP TABLE IF EXISTS quejas;

CREATE TABLE quejas (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  texto     TEXT    NOT NULL CHECK (length(texto) BETWEEN 1 AND 500),
  categoria TEXT    NOT NULL DEFAULT 'Otro' CHECK (length(categoria) <= 60),
  prioridad TEXT    NOT NULL DEFAULT 'baja' CHECK (prioridad IN ('alta', 'media', 'baja')),
  creada    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Consulta principal del panel: prioridad (alta → baja) y luego fecha desc.
CREATE INDEX idx_quejas_prioridad_fecha ON quejas (prioridad, creada DESC);
