<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import { ChevronLeft, Mail, Minus, Plus, Printer } from '@lucide/vue'
import SwitchToggle from '@/components/erp/SwitchToggle.vue'
import { formatDate, formatMoney, formatPrice, formatQty } from '@/utils/format'
import { salesInvoicesApi } from '../api/sales'
import type { InvoiceDetail } from '../types'

/** S20 · Print preview (InvoicePrint.html): an A4 page printed with the browser's own print. */
const route = useRoute()
const toast = useToast()

const inv = ref<InvoiceDetail | null>(null)
const zoom = ref(100)
const options = reactive({ copies: 1, logo: true, bank: true, delivery: true, qr: true, signature: true, photos: false })

onMounted(async () => {
  inv.value = await salesInvoicesApi.get(String(route.params.id))
  document.title = `${inv.value.docNo} · Print preview`
})

function print() {
  window.print()
}
function downloadPdf() {
  toast.add({ severity: 'info', summary: 'Download PDF', detail: 'Choose “Save as PDF” as the printer in the print dialog.', life: 4000 })
  window.print()
}
async function email() {
  const i = inv.value!
  try {
    const result = await salesInvoicesApi.email(i.id)
    toast.add({ severity: 'success', summary: 'Sent', detail: `${i.docNo} emailed to ${result.sentTo}.`, life: 4000 })
  } catch {
    /* the error toast comes from the API wrapper */
  }
}

const title = computed(() => (inv.value?.status === 'RELEASED' ? 'TAX INVOICE' : 'DRAFT INVOICE'))
const billLines = computed(() => (inv.value?.billTo ?? '').split(',').map((s) => s.trim()).filter(Boolean))
const deliverLines = computed(() => (inv.value?.customer.deliveryAddress ?? '').split(',').map((s) => s.trim()).filter(Boolean))
</script>

<template>
  <div data-module="sales" class="flex min-h-screen flex-col bg-erp-bg text-erp-text print:block print:bg-white">
    <!-- Top bar -->
    <header class="flex items-center gap-4 bg-erp-text px-5 py-2.5 text-white print:hidden">
      <RouterLink :to="`/sales/invoices/${route.params.id}`" class="flex items-center gap-1 text-[13px] font-semibold text-white no-underline">
        <ChevronLeft :size="14" aria-hidden="true" />Back to {{ inv?.docNo ?? 'invoice' }}
      </RouterLink>
      <span class="h-5 w-px bg-white/30" aria-hidden="true" />
      <h1 class="m-0 grow text-base font-bold">Print preview · {{ inv?.docNo }} · {{ inv?.customer.name }}</h1>
      <span class="text-xs text-white/70">1 page · A4</span>
      <button type="button" class="erp-btn border-0 bg-white/15 text-white" @click="downloadPdf">Download PDF</button>
      <button type="button" class="erp-btn border-0 bg-white/15 text-white" :disabled="inv?.status !== 'RELEASED'" @click="email"><Mail :size="14" aria-hidden="true" />Email to customer</button>
      <button type="button" class="erp-btn erp-btn-primary" @click="print"><Printer :size="14" aria-hidden="true" />Print</button>
    </header>

    <div class="flex grow print:block">
      <!-- Options -->
      <aside class="flex w-[280px] shrink-0 flex-col gap-3 border-r border-erp-border bg-erp-card px-5 py-5 text-[13px] print:hidden">
        <label class="flex flex-col gap-1.5 text-xs font-medium text-erp-muted">
          Printer
          <select class="erp-input text-[13px] text-erp-text"><option>This computer · browser print</option></select>
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="flex flex-col gap-1.5 text-xs font-medium text-erp-muted">Copies<input v-model.number="options.copies" type="number" min="1" class="erp-input text-[13px] text-erp-text" /></label>
          <label class="flex flex-col gap-1.5 text-xs font-medium text-erp-muted">Paper<select class="erp-input text-[13px] text-erp-text"><option>A4</option></select></label>
        </div>
        <label class="flex flex-col gap-1.5 text-xs font-medium text-erp-muted">
          Layout
          <select class="erp-input text-[13px] text-erp-text"><option>Standard tax invoice</option></select>
        </label>
        <span class="font-bold">Include</span>
        <div class="flex flex-col">
          <div v-for="o in [
            { key: 'logo', label: 'Company logo' },
            { key: 'bank', label: 'Bank details' },
            { key: 'delivery', label: 'Delivery address' },
            { key: 'qr', label: 'e-Invoice QR code' },
            { key: 'signature', label: 'Signature line' },
            { key: 'photos', label: 'Show item photos' },
          ] as const" :key="o.key" class="flex items-center justify-between border-b border-erp-row py-2">
            <span>{{ o.label }}</span>
            <SwitchToggle v-model="options[o.key]" :label="o.label" />
          </div>
        </div>
        <p class="m-0 rounded-[10px] border border-note-warn-border bg-note-warn-bg px-3 py-2.5 text-note-warn-text">
          The QR code and LHDN UUID print only after e-Invoice validation. Until then the invoice prints with “e-Invoice pending”.
        </p>
        <p class="m-0 mt-auto text-xs text-erp-muted">Layouts are set up in Operation Policies › Document Types.</p>
      </aside>

      <!-- A4 page -->
      <main class="relative flex grow justify-center overflow-auto px-6 py-5 print:block print:p-0">
        <article
          v-if="inv"
          class="flex min-h-[1123px] w-[794px] origin-top flex-col bg-white px-12 py-11 text-[11px] text-erp-text shadow-md print:min-h-0 print:w-auto print:shadow-none"
          :style="{ transform: `scale(${zoom / 100})` }"
        >
          <div class="flex items-start justify-between gap-6">
            <div class="flex items-start gap-3">
              <div v-if="options.logo" class="flex h-14 w-14 items-center justify-center border border-dashed border-erp-input text-[9px] text-erp-muted">LOGO</div>
              <div>
                <div class="text-[15px] font-bold">{{ inv.print.companyName }}</div>
                <div class="text-erp-subtle">Reg. no · address · SST no · TIN</div>
                <div class="text-erp-subtle">All from Master Data › Company</div>
              </div>
            </div>
            <div class="text-right">
              <div class="text-[20px] font-bold tracking-wide">{{ title }}</div>
              <div class="text-[13px] font-bold">{{ inv.docNo }}</div>
            </div>
          </div>

          <div class="mt-6 grid grid-cols-[1fr_1fr_1.1fr] gap-4">
            <div>
              <div class="text-[9px] text-erp-muted uppercase">Bill to</div>
              <div class="font-bold">{{ inv.customer.name }}</div>
              <div v-for="(line, n) in billLines.slice(1)" :key="n">{{ line }}</div>
              <div>Attn: {{ inv.contactName ?? '—' }} · TIN {{ inv.customer.tin ? 'on file' : 'missing' }}</div>
            </div>
            <div v-if="options.delivery">
              <div class="text-[9px] text-erp-muted uppercase">Deliver to</div>
              <div v-for="(line, n) in deliverLines" :key="n">{{ line }}</div>
            </div>
            <div v-else />
            <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <dt class="text-erp-subtle">Invoice date</dt><dd class="m-0 text-right">{{ formatDate(inv.docDate) }}</dd>
              <dt class="text-erp-subtle">Terms</dt><dd class="m-0 text-right">{{ inv.creditTermDays }} days</dd>
              <dt class="text-erp-subtle">Due date</dt><dd class="m-0 text-right">{{ formatDate(inv.dueDate ?? '') || '—' }}</dd>
              <template v-if="inv.order"><dt class="text-erp-subtle">Sales order</dt><dd class="m-0 text-right">{{ inv.order.no }}</dd></template>
              <template v-if="inv.deliveries.length"><dt class="text-erp-subtle">Delivery order</dt><dd class="m-0 text-right">{{ inv.deliveries.map((d) => d.no).join(', ') }}</dd></template>
              <template v-if="inv.customerPoRef"><dt class="text-erp-subtle">Your PO</dt><dd class="m-0 text-right">{{ inv.customerPoRef }}</dd></template>
              <dt class="text-erp-subtle">Sales agent</dt><dd class="m-0 text-right">{{ inv.agent.name }}</dd>
            </dl>
          </div>

          <table class="mt-6 w-full border-collapse">
            <thead>
              <tr class="border-b-2 border-erp-text text-[9px] uppercase">
                <th class="py-1.5 text-left">#</th><th class="py-1.5 text-left">Item</th><th class="py-1.5 text-left">Description</th>
                <th class="py-1.5 text-right">Qty</th><th class="py-1.5 pl-2 text-left">UOM</th><th class="py-1.5 text-right">Unit price</th>
                <th class="py-1.5 pl-2 text-left">Tax</th><th class="py-1.5 text-right">Amount (RM)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in inv.lines" :key="l.id" class="border-b border-erp-row align-top">
                <td class="py-1.5">{{ l.lineNo }}</td>
                <td class="py-1.5">{{ l.itemCode }}</td>
                <td class="py-1.5">
                  {{ l.itemName }}
                  <div v-if="l.orderLine && inv.deliveries.length" class="text-erp-subtle">
                    Delivered on {{ inv.deliveries.map((d) => d.no).join(', ') }} · {{ formatQty(l.orderLine.deliveredQty) }} of {{ formatQty(l.orderLine.orderedQty) }} on {{ inv.order?.no }}
                  </div>
                  <div v-if="Number(l.discountPct)" class="text-erp-subtle">less {{ Number(l.discountPct) }}% discount</div>
                </td>
                <td class="py-1.5 text-right">{{ formatQty(l.qty) }}</td>
                <td class="py-1.5 pl-2">{{ l.uomCode }}</td>
                <td class="py-1.5 text-right">{{ formatPrice(l.unitPrice) }}</td>
                <td class="py-1.5 pl-2">{{ l.taxName }}</td>
                <td class="py-1.5 text-right">{{ formatMoney(l.amount) }}</td>
              </tr>
            </tbody>
          </table>

          <div class="mt-5 flex justify-between gap-6">
            <div>
              <div class="text-[9px] text-erp-muted uppercase">Amount in words</div>
              <div>{{ inv.print.amountInWords }}</div>
              <div v-if="inv.note" class="mt-3 max-w-[340px] text-erp-subtle">{{ inv.note }}</div>
            </div>
            <dl class="m-0 grid w-[230px] shrink-0 grid-cols-[1fr_auto] gap-y-1">
              <dt>Subtotal</dt><dd class="m-0 text-right">{{ formatMoney(inv.totals.subtotal) }}</dd>
              <template v-if="Number(inv.totals.discountTotal)"><dt>Discount</dt><dd class="m-0 text-right">− {{ formatMoney(inv.totals.discountTotal) }}</dd></template>
              <template v-for="t in inv.totals.taxLines" :key="t.code"><dt>{{ t.name }}</dt><dd class="m-0 text-right">{{ formatMoney(t.amount) }}</dd></template>
              <template v-if="Number(inv.totals.rounding)"><dt>Rounding</dt><dd class="m-0 text-right">{{ formatMoney(inv.totals.rounding) }}</dd></template>
              <dt class="border-t border-erp-text pt-1.5 text-[13px] font-bold">Total (MYR)</dt>
              <dd class="m-0 border-t border-erp-text pt-1.5 text-right text-[13px] font-bold">{{ formatMoney(inv.totals.total) }}</dd>
            </dl>
          </div>

          <div class="mt-auto flex items-end justify-between gap-6 pt-10">
            <div class="flex items-end gap-4">
              <div v-if="options.qr" class="flex h-[90px] w-[90px] items-center justify-center border border-dashed border-erp-input px-2 text-center text-[8px] text-erp-muted">e-Invoice QR after LHDN validation</div>
              <div class="flex flex-col gap-1">
                <div><strong>LHDN e-Invoice:</strong> pending</div>
                <div class="text-erp-subtle">UUID and validation date print here once validated.</div>
                <div v-if="options.bank"><strong>Pay to:</strong> <span class="border border-dashed border-erp-input px-1 text-erp-muted">[Bank and account no, from Master Data]</span></div>
                <div>Reference: {{ inv.docNo }}</div>
              </div>
            </div>
            <div v-if="options.signature" class="w-[150px] border-t border-erp-text pt-1 text-center">Authorised signature</div>
          </div>
          <div class="mt-5 flex justify-between text-[9px] text-erp-muted">
            <span>This is a computer-generated invoice.</span><span>Page 1 of 1</span>
          </div>
        </article>

        <div class="fixed right-6 bottom-6 flex items-center gap-3 rounded-[10px] border border-erp-border bg-erp-card px-3 py-2 text-[13px] shadow-sm print:hidden">
          <button type="button" class="cursor-pointer border-0 bg-transparent p-1" aria-label="Zoom out" @click="zoom = Math.max(50, zoom - 10)"><Minus :size="14" /></button>
          <span class="w-10 text-center">{{ zoom }}%</span>
          <button type="button" class="cursor-pointer border-0 bg-transparent p-1" aria-label="Zoom in" @click="zoom = Math.min(150, zoom + 10)"><Plus :size="14" /></button>
        </div>
      </main>
    </div>
  </div>
</template>
