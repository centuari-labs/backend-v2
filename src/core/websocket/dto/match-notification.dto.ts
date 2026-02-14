import type { OrderDto } from './orderbook-snapshot.dto';

export interface MatchDto {
  lendOrderId: string;
  borrowOrderId: string;
  rate: number;
  quantity: string;
  timestamp: string;
}

export interface MatchNotificationDto {
  orderId: string;
  matches: MatchDto[];
  remainingOrder?: OrderDto;
  timestamp: string;
}
