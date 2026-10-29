import type { Request } from 'express';
import { HttpError } from './middleware/error';

export interface CoinInput {
  symbol: string;
  name: string;
}

function bad(message: string): never {
  throw new HttpError(400, message, 'validation_error');
}

export function parseId(raw: string | undefined): number {
  if (!raw || !/^\d+$/.test(raw)) bad('id must be a positive integer');
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) bad('id must be a positive integer');
  return id;
}

export function parseCoinInput(body: unknown, partial: boolean): Partial<CoinInput> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    bad('body must be a JSON object');
  }

  const input = body as Record<string, unknown>;
  const result: Partial<CoinInput> = {};

  if (input.symbol !== undefined) {
    if (typeof input.symbol !== 'string') bad('symbol must be a string');
    const symbol = input.symbol.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(symbol)) {
      bad('symbol must be 2-10 alphanumeric characters');
    }
    result.symbol = symbol;
  }

  if (input.name !== undefined) {
    if (typeof input.name !== 'string') bad('name must be a string');
    const name = input.name.trim();
    if (name.length < 1 || name.length > 100) bad('name must be 1-100 characters');
    result.name = name;
  }

  if (partial) {
    if (result.symbol === undefined && result.name === undefined) {
      bad('at least one of symbol or name is required');
    }
  } else if (result.symbol === undefined || result.name === undefined) {
    bad('symbol and name are required');
  }

  return result;
}

function intParam(
  query: Request['query'],
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const value = query[name];
  if (value === undefined) return fallback;
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) bad(`${name} must be an integer`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    bad(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

export interface Pagination {
  limit: number;
  offset: number;
}

export function parsePagination(query: Request['query']): Pagination {
  return {
    limit: intParam(query, 'limit', 100, 1, 1000),
    offset: intParam(query, 'offset', 0, 0, Number.MAX_SAFE_INTEGER)
  };
}

export function parseHistoryQuery(query: Request['query']): {
  from?: string;
  to?: string;
  limit: number;
  offset: number;
} {
  const from = parseDate(query.from, 'from');
  const to = parseDate(query.to, 'to');
  if (from && to && from > to) bad('from must be earlier than or equal to to');

  return {
    from,
    to,
    limit: intParam(query, 'limit', 100, 1, 1000),
    offset: intParam(query, 'offset', 0, 0, Number.MAX_SAFE_INTEGER)
  };
}

function parseDate(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || raw.trim() === '') bad(`${name} must be an ISO date`);

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) bad(`${name} must be a valid ISO date`);
  return date.toISOString();
}
