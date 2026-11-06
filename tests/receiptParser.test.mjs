import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReceiptText } from '../src/utils/receiptParser.ts';

test('does not use the receipt year instead of an ETB transfer amount', () => {
  const receipt = [
    'Bank of Abyssinia',
    'Transfer Money Successful',
    '-525.00 (ETB)',
    'Transaction Time: 2025/08/11 20:29:53',
    'Transaction Type: Transfer Money',
    'Transaction Number: CHB16E25V',
  ].join('\n');

  const result = parseReceiptText(receipt);

  assert.equal(result.fields.amount, 525);
  assert.equal(result.fields.reference_no, 'CHB16E25V');
});

test('keeps the transfer amount when the date has a larger year', () => {
  const receipt = [
    'Bank of Abyssinia',
    'Transfer Money Successful',
    '-666.00 (ETB)',
    'Transaction Time: 2025/08/11 20:26:58',
    'Transaction Type: Transfer To Bank',
    'Transaction Number: CHB16BROF',
  ].join('\n');

  const result = parseReceiptText(receipt);

  assert.equal(result.fields.amount, 666);
  assert.equal(result.fields.reference_no, 'CHB16BROF');
});

test('chooses the transfer amount and ignores a separate fee and total', () => {
  const receipt = [
    'Amount: 2.00 ETB',
    'Service Fee: 10.00 ETB',
    'Total: 12.00 ETB',
  ].join('\n');

  assert.equal(parseReceiptText(receipt).fields.amount, 2);
});

test('subtracts a separately labeled fee from an explicitly inclusive total', () => {
  const receipt = [
    'Total including fee: 530.00 ETB',
    'Service Fee: 5.00 ETB',
  ].join('\n');

  assert.equal(parseReceiptText(receipt).fields.amount, 525);
});

test('does not guess a net amount when an inclusive total has no fee value', () => {
  const receipt = ['Total including fee: 530.00 ETB'].join('\n');

  assert.equal(parseReceiptText(receipt).fields.amount, 0);
});

test('reads the CBE receipt amount and transaction ID with fee and VAT rows', () => {
  const receipt = [
    'Commercial Bank of Ethiopia',
    'Transaction Completed Successfully!',
    'You have successfully transferred 7800.0 ETB from Mias Abera Tesema-ETB-1*******5354 for CBE Birr wallet phone: +251901525863 ABDU RHIM JEMAL HUSSIEN on Nov 05, 2026 09:33 AM with Transaction ID: FT26309W04V. Reason: done',
    'Total Amount Debited 7800.00 with Service Charge of 0.0 and 15% VAT of 0.0.',
  ].join('\n');

  const result = parseReceiptText(receipt);

  assert.equal(result.fields.amount, 7800);
  assert.equal(result.fields.reference_no, 'FT26309W04V');
  assert.equal(result.fields.bank, 'Commercial Bank of Ethiopia (CBE)');
});
