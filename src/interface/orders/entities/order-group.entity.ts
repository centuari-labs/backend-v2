export type OrderGroupStatus = "active" | "cancelled" | "completed";

export interface OrderGroup {
    id: number;
    wallet_address: string;
    name: string | null;
    description: string | null;
    status: OrderGroupStatus;
    created_at: Date;
    updated_at: Date;
}
