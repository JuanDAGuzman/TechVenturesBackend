// Las fotos subidas desde el admin pueden estar guardadas como data-URI (base64) dentro de la base de datos.
// Si viajan dentro del listado de productos, cada visitante descarga todas esas fotos antes de ver
// una sola tarjeta. Aquí se reemplazan por una URL corta que sirve la foto por separado (y cacheable).

const BASE_URL = (
  process.env.PUBLIC_URL ||
  process.env.BASE_URL ||
  "https://techventuresbackend-production.up.railway.app"
).replace(/\/+$/, "");

export function slimProductImage(product) {
  const url = product?.image_url;
  if (typeof url === "string" && url.startsWith("data:")) {
    // "v" cambia cuando se edita el producto, así el navegador puede cachear la foto de forma indefinida
    const v = product.updated_at ? new Date(product.updated_at).getTime() : 0;
    return { ...product, image_url: `${BASE_URL}/api/catalog/products/${product.id}/image?v=${v}` };
  }
  return product;
}
