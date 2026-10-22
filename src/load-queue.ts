export type LoadResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

interface Job<T> {
  load: () => Promise<T>;
  listeners: Set<(result: LoadResult<T>) => void>;
}

/**
 * Fila de carregamentos com concorrência limitada.
 *
 * - Pedidos repetidos da mesma chave se juntam num só carregamento.
 * - O que foi pedido por último sai primeiro: numa rolagem rápida, o que está na tela agora
 *   vale mais do que o que passou.
 * - `cancel` tira o interesse de quem pediu; o que ainda não começou e ficou sem interessados
 *   é descartado. O que já começou termina (não dá para interromper), e o resultado é entregue
 *   a quem ainda estiver interessado.
 */
export class LoadQueue<T> {
  private readonly pending: string[] = [];
  private readonly jobs = new Map<string, Job<T>>();
  private readonly concurrency: number;
  private inFlight = 0;

  // Sem "parameter properties": o Node só remove tipos do TypeScript e não as suporta (testes).
  constructor(concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new RangeError("concurrency deve ser um inteiro >= 1");
    }
    this.concurrency = concurrency;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get inFlightCount(): number {
    return this.inFlight;
  }

  request(key: string, load: () => Promise<T>, listener: (result: LoadResult<T>) => void): void {
    const existing = this.jobs.get(key);
    if (existing) {
      existing.listeners.add(listener);
      // Pedido de novo = voltou a ser relevante: passa para a frente da fila.
      const i = this.pending.indexOf(key);
      if (i >= 0) {
        this.pending.splice(i, 1);
        this.pending.push(key);
      }
      return;
    }
    this.jobs.set(key, { load, listeners: new Set([listener]) });
    this.pending.push(key);
    this.pump();
  }

  cancel(key: string, listener: (result: LoadResult<T>) => void): void {
    const job = this.jobs.get(key);
    if (!job) return;
    job.listeners.delete(listener);
    if (job.listeners.size > 0) return;
    const i = this.pending.indexOf(key);
    if (i >= 0) {
      this.pending.splice(i, 1);
      this.jobs.delete(key);
    }
  }

  /** Descarta tudo que ainda não começou (ex.: ao trocar de pasta). */
  clearPending(): void {
    for (const key of this.pending) this.jobs.delete(key);
    this.pending.length = 0;
  }

  private pump(): void {
    while (this.inFlight < this.concurrency && this.pending.length > 0) {
      const key = this.pending.pop() as string;
      const job = this.jobs.get(key);
      if (!job) continue;
      this.inFlight += 1;
      const finish = (result: LoadResult<T>): void => {
        this.inFlight -= 1;
        this.jobs.delete(key);
        for (const listener of job.listeners) listener(result);
        this.pump();
      };
      let started: Promise<T>;
      try {
        started = job.load();
      } catch (error) {
        started = Promise.reject(error);
      }
      started.then(
        (value) => finish({ ok: true, value }),
        (error: unknown) => finish({ ok: false, error }),
      );
    }
  }
}
