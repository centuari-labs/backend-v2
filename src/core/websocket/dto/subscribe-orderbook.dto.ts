export interface SubscribeOrderbookDto {
  loanToken: string;
  maturity: number;
}

export interface UnsubscribeOrderbookDto {
  loanToken: string;
  maturity: number;
}

export interface SubscribeUserOrdersDto {
  accountId: string;
}

export interface UnsubscribeUserOrdersDto {
  accountId: string;
}
