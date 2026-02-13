export type OrderErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_ORDER'
  | 'ORDER_NOT_FOUND'
  | 'RATE_MISMATCH'
  | 'INSUFFICIENT_LIQUIDITY'
  | 'INTERNAL_ERROR'
  | 'NATS_CONNECTION_ERROR'
  | 'MESSAGE_PARSE_ERROR';

export interface OrderErrorDto {
  orderId?: string;
  accountId?: string;
  errorCode: OrderErrorCode;
  message: string;
  timestamp: string;
}
