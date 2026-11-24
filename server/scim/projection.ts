import { scimBadRequest } from './errors.js';

type Resource = Record<string, unknown>;

function isRecord(value: unknown): value is Resource {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** RFC 7644 §3.9. Attribute names are case-insensitive and may carry the core schema URI. */
export class AttributeProjection {
  private constructor(private readonly include: boolean, private readonly paths: Map<string, Set<string>>) {}

  static parse(query: { attributes?: unknown; excludedAttributes?: unknown }, schema: string): AttributeProjection | undefined {
    const { attributes, excludedAttributes } = query;
    if (attributes !== undefined && excludedAttributes !== undefined) throw scimBadRequest('attributes and excludedAttributes are mutually exclusive');
    const parameter = attributes ?? excludedAttributes;
    if (parameter === undefined) return undefined;
    if (typeof parameter !== 'string' || !parameter.trim()) throw scimBadRequest('expected a comma-separated list of attribute paths');
    const paths = new Map<string, Set<string>>();
    const prefix = schema.toLowerCase() + ':';
    for (const item of parameter.split(',')) {
      const path = item.trim().toLowerCase();
      // A different schema names attributes outside this provider's core resource.
      if (path.includes(':') && !path.startsWith(prefix)) continue;
      const local = path.startsWith(prefix) ? path.slice(prefix.length) : path;
      if (!/^[a-z][\w-]*(?:\.(?:[a-z][\w-]*|\$ref))?$/.test(local)) throw scimBadRequest('invalid SCIM attribute path');
      const [name, sub = ''] = local.split('.');
      const subs = paths.get(name) ?? new Set<string>();
      subs.add(sub);
      paths.set(name, subs);
    }
    return new AttributeProjection(attributes !== undefined, paths);
  }

  wants(name: string): boolean {
    const subs = this.paths.get(name);
    return this.include ? Boolean(subs) : !subs?.has('');
  }

  private resource(resource: Resource): Resource {
    const output: Resource = {};
    for (const [name, value] of Object.entries(resource)) {
      const key = name.toLowerCase();
      if (key === 'id' || key === 'schemas') {
        output[name] = value;
        continue;
      }
      if (!this.wants(key)) continue;
      const subs = this.paths.get(key);
      if (!subs || subs.has('')) {
        output[name] = value;
        continue;
      }
      const projectObject = (item: Resource) => Object.fromEntries(Object.entries(item).filter(([k]) => subs.has(k.toLowerCase()) === this.include));
      if (Array.isArray(value)) {
        const projected = value.filter(isRecord).map(projectObject).filter((item) => Object.keys(item).length > 0);
        if (projected.length || !value.length) output[name] = projected;
      } else if (isRecord(value)) {
        const projected = projectObject(value);
        if (Object.keys(projected).length) output[name] = projected;
      } else if (!this.include) {
        output[name] = value;
      }
    }
    return output;
  }

  response(body: unknown): unknown {
    if (!isRecord(body)) return body;
    if (Array.isArray(body.Resources)) return { ...body, Resources: body.Resources.map((item: Resource) => this.resource(item)) };
    return this.resource(body);
  }
}
