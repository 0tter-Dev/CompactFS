/** Cache com tamanho máximo: ao passar do limite descarta o item usado há mais tempo. */
export class Lru<K, V> {
  private readonly map = new Map<K, V>();
  private readonly max: number;
  /** Chamado ao descartar (ex.: liberar um `ImageBitmap`). */
  private readonly onEvict: ((key: K, value: V) => void) | undefined;

  // Sem "parameter properties": o Node só remove tipos do TypeScript e não as suporta (testes).
  constructor(max: number, onEvict?: (key: K, value: V) => void) {
    if (!Number.isInteger(max) || max < 1) throw new RangeError("max deve ser um inteiro >= 1");
    this.max = max;
    this.onEvict = onEvict;
  }

  get size(): number {
    return this.map.size;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Lê sem alterar a ordem de uso. */
  peek(key: K): V | undefined {
    return this.map.get(key);
  }

  /** Lê e marca como usado agora. */
  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      const old = this.map.get(key) as V;
      this.map.delete(key);
      if (old !== value) this.onEvict?.(key, old);
    }
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.entries().next().value as [K, V];
      this.map.delete(oldest[0]);
      this.onEvict?.(oldest[0], oldest[1]);
    }
  }

  clear(): void {
    const all = [...this.map.entries()];
    this.map.clear();
    for (const [k, v] of all) this.onEvict?.(k, v);
  }
}
