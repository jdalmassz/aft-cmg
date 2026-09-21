-- Limpieza de datos: unificar custodio duplicado
-- 10 'ALFREDO HERNANDEZ OLIVA' (nombre incompleto) -> 1 'ALFREDO LAUDELINO HERNANDEZ OLIVA' (misma persona)

INSERT INTO movimientos (activo_id, tipo, custodio_destino_id, estado_destino, comentario)
SELECT a.id, 'CAMBIO_CUSTODIO', d.id, a.estado,
       'Responsable duplicado unificado: ALFREDO HERNANDEZ OLIVA -> ALFREDO LAUDELINO HERNANDEZ OLIVA'
FROM activos a
JOIN custodios d ON d.nombre = 'ALFREDO LAUDELINO HERNANDEZ OLIVA'
WHERE a.custodio_id = (SELECT id FROM custodios WHERE nombre = 'ALFREDO HERNANDEZ OLIVA');

UPDATE activos a
SET custodio_id = d.id, updated_at = now()
FROM (SELECT id FROM custodios WHERE nombre = 'ALFREDO LAUDELINO HERNANDEZ OLIVA') d
WHERE a.custodio_id = (SELECT id FROM custodios WHERE nombre = 'ALFREDO HERNANDEZ OLIVA');

-- Repuntar los movimientos previos que referenciaban al custodia duplicado
UPDATE movimientos m
SET custodio_destino_id = d.id
FROM (SELECT id FROM custodios WHERE nombre = 'ALFREDO LAUDELINO HERNANDEZ OLIVA') d
WHERE m.custodio_destino_id = (SELECT id FROM custodios WHERE nombre = 'ALFREDO HERNANDEZ OLIVA');

UPDATE movimientos m
SET custodio_origen_id = d.id
FROM (SELECT id FROM custodios WHERE nombre = 'ALFREDO LAUDELINO HERNANDEZ OLIVA') d
WHERE m.custodio_origen_id = (SELECT id FROM custodios WHERE nombre = 'ALFREDO HERNANDEZ OLIVA');

DELETE FROM custodios WHERE nombre = 'ALFREDO HERNANDEZ OLIVA';