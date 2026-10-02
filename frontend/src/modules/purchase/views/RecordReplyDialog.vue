<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import DatePicker from 'primevue/datepicker'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'
import { ApiError } from '@/api/http'
import FormField from '@/components/erp/FormField.vue'
import { useSession } from '@/composables/useSession'
import { formatQty } from '@/utils/format'
import { attachmentsApi, rfqsApi } from '../api/purchase'
import type { RfqDetail, RfqSupplierReply } from '../types'

/**
 * Record a supplier's reply (FlowP2 step 3). Suppliers answer by email or with their quote PDF; the buyer
 * types the price, delivery time, minimum order, payment term and validity here.
 */
const props = defineProps<{ rfq: RfqDetail; supplier: RfqSupplierReply | null }>()
const visible = defineModel<boolean>('visible', { default: false })
const emit = defineEmits<{ saved: [rfq: RfqDetail] }>()
const toast = useToast()
const { today } = useSession()

const form = reactive({
  declined: false,
  prices: {} as Record<number, { unitPrice: string; minOrderQty: string }>,
  leadTimeDays: '',
  paymentTermDays: '',
  validUntil: '',
  quoteRef: '',
  note: '',
})
const file = ref<File | null>(null)
const errors = ref<Record<string, string>>({})
const saving = ref(false)
const plain = (v: string | null | undefined) => (v ? formatQty(v).replace(/,/g, '') : '')

watch(
  visible,
  (open) => {
    if (!open || !props.supplier) return
    const s = props.supplier
    form.declined = s.status === 'DECLINED'
    form.prices = Object.fromEntries(
      props.rfq.lines.map((l) => {
        const p = s.prices.find((x) => x.lineNo === l.lineNo)
        return [l.lineNo, { unitPrice: p ? p.unitPrice.replace(/0{1,2}$/, '') : '', minOrderQty: plain(p?.minOrderQty) }]
      }),
    )
    form.leadTimeDays = s.leadTimeDays?.toString() ?? ''
    form.paymentTermDays = s.paymentTermDays?.toString() ?? ''
    form.validUntil = s.validUntil ?? ''
    form.quoteRef = s.quoteRef ?? ''
    form.note = s.note ?? ''
    file.value = null
    errors.value = {}
  },
  { immediate: true },
)

const pad = (n: number) => String(n).padStart(2, '0')
const isoToDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : null)
const setValidUntil = (value: unknown) =>
  (form.validUntil = value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '')
const title = computed(() => (props.supplier?.status === 'ASKED' ? 'Record reply' : 'Change reply'))

function onFile(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
}

async function save() {
  if (!props.supplier) return
  saving.value = true
  errors.value = {}
  try {
    const attachmentIds = file.value ? [(await attachmentsApi.upload(file.value, 'QUOTE')).id] : undefined
    const result = await rfqsApi.recordReply(
      props.rfq.id,
      form.declined
        ? { version: props.rfq.version, supplierCode: props.supplier.code, declined: true, note: form.note || undefined }
        : {
            version: props.rfq.version,
            supplierCode: props.supplier.code,
            lines: props.rfq.lines
              .filter((l) => form.prices[l.lineNo]?.unitPrice)
              .map((l) => ({ lineNo: l.lineNo, unitPrice: form.prices[l.lineNo]!.unitPrice, minOrderQty: form.prices[l.lineNo]!.minOrderQty || undefined })),
            leadTimeDays: form.leadTimeDays === '' ? undefined : Number(form.leadTimeDays),
            paymentTermDays: form.paymentTermDays === '' ? undefined : Number(form.paymentTermDays),
            validUntil: form.validUntil || undefined,
            quoteRef: form.quoteRef || undefined,
            note: form.note || undefined,
            attachmentIds,
          },
    )
    toast.add({ severity: 'success', summary: `Reply from ${props.supplier.shortName ?? props.supplier.name} saved`, life: 3000 })
    visible.value = false
    emit('saved', result)
  } catch (e) {
    if (e instanceof ApiError) errors.value = e.fieldErrors
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :draggable="false" class="erp-dialog" :style="{ width: '640px' }">
    <template #header>
      <div>
        <h2 class="m-0 text-xl font-bold">{{ title }} · {{ supplier?.shortName ?? supplier?.name }}</h2>
        <p class="m-0 mt-1 text-[13px] text-erp-muted">Type in what {{ supplier?.shortName ?? 'the supplier' }} sent for {{ rfq.docNo }}, as on their quote.</p>
      </div>
    </template>

    <div class="flex flex-col gap-4">
      <label class="flex items-center gap-2 text-[13px]">
        <input v-model="form.declined" type="checkbox" />
        The supplier will not quote this time
      </label>

      <template v-if="!form.declined">
        <table class="erp-table">
          <thead>
            <tr>
              <th>Item</th>
              <th class="num">Qty asked</th>
              <th class="num">Unit price (RM)</th>
              <th class="num">Minimum order</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(l, i) in rfq.lines" :key="l.lineNo">
              <td>
                <div class="font-semibold whitespace-nowrap">{{ l.itemCode }}</div>
                <div class="text-xs text-erp-muted">{{ l.itemName }}</div>
              </td>
              <td class="num">{{ formatQty(l.qty) }} {{ l.uomCode }}</td>
              <td class="num">
                <input
                  v-if="form.prices[l.lineNo]"
                  v-model="form.prices[l.lineNo]!.unitPrice"
                  class="erp-cell w-[96px]"
                  inputmode="decimal"
                  :aria-invalid="Boolean(errors[`lines[${i}].unitPrice`])"
                  :aria-label="`Unit price ${l.itemCode}`"
                />
              </td>
              <td class="num">
                <input v-if="form.prices[l.lineNo]" v-model="form.prices[l.lineNo]!.minOrderQty" class="erp-cell w-[80px]" inputmode="decimal" :aria-label="`Minimum order ${l.itemCode}`" />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="errors.lines" class="m-0 -mt-2 text-xs font-medium text-note-error-text" role="alert">{{ errors.lines }}</p>

        <div class="grid grid-cols-2 gap-3">
          <FormField label="Delivery time (days)" :error="errors.leadTimeDays" for="lead-time">
            <input id="lead-time" v-model="form.leadTimeDays" class="erp-input" inputmode="numeric" placeholder="e.g. 7 for one week" />
          </FormField>
          <FormField label="Payment term (days)" :error="errors.paymentTermDays" for="payment-term">
            <input id="payment-term" v-model="form.paymentTermDays" class="erp-input" inputmode="numeric" placeholder="e.g. 30" />
          </FormField>
          <FormField label="Quote valid until" :error="errors.validUntil" for="valid-until">
            <DatePicker
              input-id="valid-until"
              :model-value="isoToDate(form.validUntil)"
              :min-date="isoToDate(today) ?? undefined"
              date-format="d M yy"
              show-icon
              show-button-bar
              fluid
              class="erp-date"
              @update:model-value="setValidUntil"
            />
          </FormField>
          <FormField label="Their quote number" for="quote-ref">
            <input id="quote-ref" v-model="form.quoteRef" class="erp-input" maxlength="50" placeholder="e.g. KKJ-Q-5512" />
          </FormField>
          <FormField label="Their quote (PDF or photo)" class="col-span-2" for="quote-file">
            <input id="quote-file" type="file" accept="application/pdf,image/*" class="text-[13px]" @change="onFile" />
          </FormField>
        </div>
      </template>

      <FormField label="Note" for="reply-note">
        <textarea id="reply-note" v-model="form.note" class="erp-input min-h-16 py-2" maxlength="1000" placeholder="Anything else they said" />
      </FormField>
    </div>

    <template #footer>
      <div class="flex w-full items-center justify-end gap-2">
        <button type="button" class="erp-btn erp-btn-secondary" @click="visible = false">Cancel</button>
        <button type="button" class="erp-btn erp-btn-primary" :disabled="saving" @click="save">Save reply</button>
      </div>
    </template>
  </Dialog>
</template>
