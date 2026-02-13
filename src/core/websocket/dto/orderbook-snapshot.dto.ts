import type { OrderSide, OrderStatus, OrderType } from '../../../orders/constants/order.constants';

export interface OrderDto {
  id: string;
  accountId: string;
  assetId: string;
  side: OrderSide;
  type: OrderType;
  rate: number;
  quantity: string;
  filledQuantity: string;
  settlementFee: string;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderBookSnapshotDto {
  loanToken: string;
  maturity: number;
  lendOrders: OrderDto[];
  borrowOrders: OrderDto[];
  timestamp: string;
}
