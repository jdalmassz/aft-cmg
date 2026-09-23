-- Áreas iniciales (Área 1, 2, 3, 4) y a cuál va cada ubicación del Excel original.
-- Se aplica una sola vez; después se cambian desde la pantalla Áreas.

INSERT INTO areas (numero) VALUES (1), (2), (3), (4)
ON CONFLICT (numero) DO NOTHING;

UPDATE ubicaciones u SET area_id = a.id
FROM areas a
WHERE u.area_id IS NULL AND (
     (a.numero = 1 AND u.nombre = 'DIRECCION')
  OR (a.numero = 2 AND (u.nombre = 'COMERCIAL' OR u.nombre LIKE 'FACTURACION%'))
  OR (a.numero = 3 AND u.nombre = 'ECONOMIA')
  OR (a.numero = 4 AND u.nombre IN ('LOGISTICA', 'ALMACEN'))
);
