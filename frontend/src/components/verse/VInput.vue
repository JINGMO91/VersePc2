<script setup>
// VInput.vue — 业务输入框封装
// 无 v-model 时保持非受控：现有部分交互按 id 直接读 DOM 的 value，不能被强制回写。
import { computed } from 'vue';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const props = defineProps({
  modelValue: { type: [String, Number], default: undefined },
  class: { type: [String, Object, Array], default: '' },
  type: { type: String, default: 'text' },
  placeholder: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue']);

const value = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});
</script>

<template>
  <Input
    v-model="value"
    :type="type"
    :placeholder="placeholder"
    :class="cn('v-input', props.class)"
  />
</template>
