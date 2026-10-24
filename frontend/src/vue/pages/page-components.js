/* page-components - 组件基座预览页
 * 用途：目测 shadcn-vue 组件与现有手写控件的差异，验收组件基座。
 * 入口：主应用在 dev 模式下追加（vue/dev-preview.js），
 *       或直接访问 dev-components.html 独立查看。
 * 模板只做展示，不承载业务逻辑。
 */
import { ref } from 'vue';
import VButton from '@/components/verse/VButton.vue';
import VInput from '@/components/verse/VInput.vue';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export default {
  components: {
    VButton,
    VInput,
    Badge,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Checkbox,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Skeleton,
    Switch,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
  },
  setup() {
    const text = ref('');
    const switchOn = ref(true);
    const checked = ref(true);
    const choice = ref('a');

    return { text, switchOn, checked, choice };
  },
  template: `
    <div class="page-header">
      <h2>组件基座预览</h2>
      <div class="page-actions">
        <span class="badge" style="font-size:11px">仅开发环境</span>
      </div>
    </div>

    <div class="vp-grid">
      <Card>
        <CardHeader>
          <CardTitle>按钮</CardTitle>
          <CardDescription>对齐现有 .btn / .btn-accent / .btn-secondary 三档</CardDescription>
        </CardHeader>
        <CardContent class="vp-row">
          <VButton variant="accent">主行动</VButton>
          <VButton variant="secondary">次级</VButton>
          <VButton variant="ghost">幽灵</VButton>
          <VButton variant="danger">危险</VButton>
          <VButton variant="secondary" size="sm">小号</VButton>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>表单控件</CardTitle>
          <CardDescription>输入框、开关、复选框、下拉选择</CardDescription>
        </CardHeader>
        <CardContent class="vp-stack">
          <VInput v-model="text" placeholder="请输入内容" />
          <div class="vp-row">
            <Switch v-model="switchOn" id="vp-switch" />
            <Label for="vp-switch">启用开关</Label>
          </div>
          <div class="vp-row">
            <Checkbox v-model="checked" id="vp-check" />
            <Label for="vp-check">勾选选项</Label>
          </div>
          <Select v-model="choice">
            <SelectTrigger class="vp-select">
              <SelectValue placeholder="请选择" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a">选项 A</SelectItem>
              <SelectItem value="b">选项 B</SelectItem>
              <SelectItem value="c">选项 C</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>浮层</CardTitle>
          <CardDescription>弹窗、下拉菜单、气泡提示</CardDescription>
        </CardHeader>
        <CardContent class="vp-row">
          <Dialog>
            <DialogTrigger as-child>
              <VButton variant="accent">打开弹窗</VButton>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>弹窗标题</DialogTitle>
                <DialogDescription>用于替代现有 .modal 结构。</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <VButton variant="secondary">取消</VButton>
                <VButton variant="accent">确定</VButton>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <VButton variant="secondary">下拉菜单</VButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>操作</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>重命名</DropdownMenuItem>
              <DropdownMenuItem>复制</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <VButton variant="ghost">气泡提示</VButton>
              </TooltipTrigger>
              <TooltipContent>这是提示内容</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>标签页与状态</CardTitle>
          <CardDescription>选项卡、徽章、骨架屏</CardDescription>
        </CardHeader>
        <CardContent class="vp-stack">
          <Tabs default-value="one">
            <TabsList>
              <TabsTrigger value="one">标签一</TabsTrigger>
              <TabsTrigger value="two">标签二</TabsTrigger>
            </TabsList>
            <TabsContent value="one">标签一的内容区域</TabsContent>
            <TabsContent value="two">标签二的内容区域</TabsContent>
          </Tabs>
          <div class="vp-row">
            <Badge>默认</Badge>
            <Badge variant="secondary">次级</Badge>
            <Badge variant="destructive">危险</Badge>
          </div>
          <Skeleton class="vp-skeleton" />
        </CardContent>
      </Card>
    </div>
  `,
};
