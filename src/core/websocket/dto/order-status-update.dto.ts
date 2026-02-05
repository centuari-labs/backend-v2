import type { OrderStatus } from '../../../orders/constants/order.constants';

export interface OrderStatusUpdateDto {
  orderId: string;
  accountId: string;
  status: OrderStatus;
  filledQuantity?: string;
  timestamp: string;
}
