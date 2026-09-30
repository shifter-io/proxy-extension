/**
 * Normalizes a location label into a gateway-safe slug, same rules as the
 * panel endpoint builder and the residential VPN app (shifter_slug.dart):
 * lowercase, accents stripped, whitespace/hyphen runs -> `_`.
 *
 *   "Los Angeles" -> "los_angeles", "Île-de-France" -> "ile_de_france"
 */
export function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}
