export function bankConfig(env = process.env) {
  const bankId = (env.VIETQR_BANK_ID || '').trim();
  const accountNo = (env.VIETQR_ACCOUNT_NO || '').trim();
  const accountName = (env.VIETQR_ACCOUNT_NAME || '').trim();
  const bankName = (env.VIETQR_BANK_NAME || bankId).trim();
  const enabled = /^[a-zA-Z0-9]{2,20}$/.test(bankId) && /^\d{6,19}$/.test(accountNo) && accountName.length >= 2 && accountName.length <= 100;
  return { enabled, bankId, bankName, accountNo, accountName };
}
export function paymentDetails(bank, order, expiresAt) {
  const content = `DH${order.order_code}`;
  const url = new URL(`https://img.vietqr.io/image/${bank.bankId}-${bank.accountNo}-compact2.png`);
  url.search = new URLSearchParams({ amount: String(order.total), addInfo: content, accountName: bank.accountName }).toString();
  return { bank_name: bank.bankName, account_no: bank.accountNo, account_name: bank.accountName, amount: order.total, content, qr_url: url.href, expires_at: expiresAt };
}
