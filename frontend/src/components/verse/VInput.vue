<script setup>
// VInput.vue — 业务输入框封装
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

defineProps({
  modelValue: { type: [String, Number], default: '' },
  class: { type: [String, Object, Array], default: '' },
  type: { type: String, default: 'text' },
  placeholder: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue']);
</script>

<template>
  <Input
    :model-value="modelValue"
    :type="type"
    :placeholder="placeholder"
    :class="cn('v-input', $props.class)"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
