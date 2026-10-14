/**
 * LHDN e-Invoice classification codes (SRS FR-MST-008), as listed in the MyInvois SDK's "Classification Codes".
 * Items pick one; e-Invoices carry it on every line. Check the list against the current SDK before go-live:
 * LHDN adds codes from time to time, and a new one is one line here.
 */
export const EINVOICE_CLASSIFICATIONS: readonly { code: string; name: string }[] = [
  { code: '001', name: 'Breastfeeding equipment' },
  { code: '002', name: 'Child care centres and kindergartens fees' },
  { code: '003', name: 'Computer, smartphone or tablet' },
  { code: '004', name: 'Consolidated e-Invoice' },
  { code: '005', name: 'Construction materials' },
  { code: '006', name: 'Disbursement' },
  { code: '007', name: 'Donation' },
  { code: '008', name: 'e-Commerce - e-Invoice to buyer / purchaser' },
  { code: '009', name: 'e-Commerce - Self-billed e-Invoice to seller, logistics, etc.' },
  { code: '010', name: 'Education fees' },
  { code: '011', name: 'Goods on consignment (Consignor)' },
  { code: '012', name: 'Goods on consignment (Consignee)' },
  { code: '013', name: 'Gym membership' },
  { code: '014', name: 'Insurance - Education and medical benefits' },
  { code: '015', name: 'Insurance - Takaful or life insurance' },
  { code: '016', name: 'Interest and financing expenses' },
  { code: '017', name: 'Internet subscription' },
  { code: '018', name: 'Land and building' },
  { code: '019', name: 'Medical examination for learning disabilities and early intervention or rehabilitation treatments of learning disabilities' },
  { code: '020', name: 'Medical examination or vaccination expenses' },
  { code: '021', name: 'Medical expenses for serious diseases' },
  { code: '022', name: 'Others' },
  { code: '023', name: 'Petroleum operations' },
  { code: '024', name: 'Private retirement scheme or deferred annuity scheme' },
  { code: '025', name: 'Motor vehicle' },
  { code: '026', name: 'Subscription of books / journals / magazines / newspapers / other similar publications' },
  { code: '027', name: 'Reimbursement' },
  { code: '028', name: 'Rental of motor vehicle' },
  { code: '029', name: 'EV charging facilities (installation, rental, sale / purchase or subscription fees)' },
  { code: '030', name: 'Repair and maintenance' },
  { code: '031', name: 'Research and development' },
  { code: '032', name: 'Foreign income' },
  { code: '033', name: 'Self-billed - Betting and gaming' },
  { code: '034', name: 'Self-billed - Importation of goods' },
  { code: '035', name: 'Self-billed - Importation of services' },
  { code: '036', name: 'Self-billed - Others' },
  { code: '037', name: 'Self-billed - Monetary payment to agents, dealers or distributors' },
  { code: '038', name: 'Sports equipment, rental / entry fees for sports facilities, registration in sports competition or sports training fees' },
  { code: '039', name: 'Supporting equipment for disabled person' },
  { code: '040', name: 'Voluntary contribution to approved provident fund' },
  { code: '041', name: 'Dental examination or treatment' },
  { code: '042', name: 'Fertility treatment' },
  { code: '043', name: 'Treatment and home care nursing, daycare centres and residential care centres' },
  { code: '044', name: 'Vouchers, gift cards, loyalty points, etc.' },
  { code: '045', name: 'Self-billed - Non-monetary payment to agents, dealers or distributors' },
];

export function classificationName(code: string | null | undefined): string | null {
  return EINVOICE_CLASSIFICATIONS.find((c) => c.code === code)?.name ?? null;
}
