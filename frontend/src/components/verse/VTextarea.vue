<script setup>
// VTextarea.vue — 业务多行输入框封装
// 无 v-model 时保持非受控，兼容现有按 id 直接读 DOM 的交互代码。
import { computed } from 'vue';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const props = defineProps({
  modelValue: { type: [String, Number], default: undefined },
  class: { type: [String, Object, Array], default: '' },
  placeholder: { type: String, default: '' },
  rows: { type: [String, Number], default: undefined },
});
const emit = defineEmits(['update:modelValue']);

const value = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});
</script>

<template>
  <Textarea
    v-model="value"
    :rows="rows"
    :placeholder="placeholder"
    :class="cn('v-textarea', props.class)"
  />
</template>
