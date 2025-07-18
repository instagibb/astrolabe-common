import { FormNode, lookupDataNode } from "./formNode";
import {
  hideDisplayOnly,
  SchemaDataNode,
  validDataNode,
} from "./schemaDataNode";
import { SchemaInterface } from "./schemaInterface";
import { FieldOption } from "./schemaField";
import {
  ChangeListenerFunc,
  CleanupScope,
  Control,
  createScopedEffect,
  createSyncEffect,
  newControl,
  updateComputedValue,
  updateElements,
} from "@astroapps/controls";
import { createEvalExpr, ExpressionEvalContext } from "./evalExpression";
import { EntityExpression } from "./entityExpression";
import { createScoped } from "./util";
import {
  AnyControlDefinition,
  ControlAdornmentType,
  ControlDefinition,
  ControlDisableType,
  DataGroupRenderOptions,
  DataRenderType,
  DynamicPropertyType,
  getGroupRendererOptions,
  GridRendererOptions,
  HtmlDisplay,
  isActionControl,
  isControlDisabled,
  isControlReadonly,
  isDataControl,
  isDataGroupRenderer,
  isDisplayControl,
  isGroupControl,
  isHtmlDisplay,
  isTextDisplay,
  TextDisplay,
} from "./controlDefinition";
import { createOverrideProxy, KeysOfUnion, NoOverride } from "./overrideProxy";
import { ChildNodeSpec, ChildResolverFunc } from "./resolveChildren";
import { setupValidation } from "./validators";
import { groupedControl } from "./controlBuilder";

export type EvalExpr = <A>(
  scope: CleanupScope,
  init: A,
  nk: Control<A>,
  e: EntityExpression | undefined,
  coerce: (t: unknown) => any,
) => boolean;

export type VariablesFunc = (
  changes: ChangeListenerFunc<any>,
) => Record<string, any>;
export interface FormNodeOptions {
  forceReadonly?: boolean;
  forceDisabled?: boolean;
  forceHidden?: boolean;
  variables?: VariablesFunc;
}
export interface FormGlobalOptions {
  schemaInterface: SchemaInterface;
  evalExpression: (e: EntityExpression, ctx: ExpressionEvalContext) => void;
  resolveChildren(c: FormStateNode): ChildNodeSpec[];
  runAsync: (af: () => void) => void;
  clearHidden: boolean;
}

export interface ResolvedDefinition {
  definition: ControlDefinition;
  display?: string;
  stateId?: string;
  style?: object;
  layoutStyle?: object;
  fieldOptions?: FieldOption[];
}

export interface FormStateBase {
  parent: SchemaDataNode;
  dataNode?: SchemaDataNode | undefined;
  readonly: boolean;
  visible: boolean | null;
  disabled: boolean;
  resolved: ResolvedDefinition;
  childIndex: number;
  busy: boolean;
}

export interface FormNodeUi {
  ensureVisible(): void;
  ensureChildVisible(childIndex: number): void;
  getDisabler(type: ControlDisableType): () => () => void;
}

export interface FormStateNode extends FormStateBase, FormNodeOptions {
  childKey: string | number;
  uniqueId: string;
  definition: ControlDefinition;
  schemaInterface: SchemaInterface;
  valid: boolean;
  touched: boolean;
  clearHidden: boolean;
  variables?: (changes: ChangeListenerFunc<any>) => Record<string, any>;
  meta: Record<string, any>;
  form: FormNode | undefined | null;
  children: FormStateNode[];
  parentNode: FormStateNode | undefined;
  setTouched(b: boolean, notChildren?: boolean): void;
  validate(): boolean;
  getChildCount(): number;
  getChild(index: number): FormStateNode | undefined;
  ensureMeta<A>(key: string, init: (scope: CleanupScope) => A): A;
  cleanup(): void;
  ui: FormNodeUi;
  attachUi(f: FormNodeUi): void;
  setBusy(busy: boolean): void;
  setForceDisabled(forceDisable: boolean): void;
}
export function createEvaluatedDefinition(
  def: ControlDefinition,
  evalExpr: EvalExpr,
  scope: CleanupScope,
  display: Control<string | undefined>,
): ControlDefinition {
  const definitionOverrides = createScoped<Record<string, any>>(scope, {});
  const displayOverrides = createScoped<Record<string, any>>(scope, {});
  const groupOptionsOverrides = createScoped<Record<string, any>>(scope, {});
  const renderOptionsOverrides = createScoped<Record<string, any>>(scope, {});

  const {
    hidden,
    displayData,
    readonly,
    disabled,
    defaultValue,
    actionData,
    title,
    groupOptions,
    renderOptions,
  } = definitionOverrides.fields as Record<
    KeysOfUnion<AnyControlDefinition>,
    Control<any>
  >;

  const { columns } = groupOptionsOverrides.fields as Record<
    KeysOfUnion<GridRendererOptions>,
    Control<any>
  >;

  const { groupOptions: dataGroupRenderOptions } =
    renderOptionsOverrides.fields as Record<
      KeysOfUnion<DataGroupRenderOptions>,
      Control<any>
    >;

  const { html, text } = displayOverrides.fields as Record<
    KeysOfUnion<TextDisplay | HtmlDisplay>,
    Control<any>
  >;

  updateComputedValue(dataGroupRenderOptions, () =>
    isDataControl(def) && isDataGroupRenderer(def.renderOptions)
      ? createOverrideProxy(
          (def.renderOptions.groupOptions as GridRendererOptions) ?? {},
          groupOptionsOverrides,
        )
      : undefined,
  );

  updateComputedValue(displayData, () =>
    isDisplayControl(def)
      ? createOverrideProxy(def.displayData, displayOverrides)
      : undefined,
  );

  updateComputedValue(groupOptions, () => {
    const groupOptions = getGroupRendererOptions(def);
    return groupOptions
      ? createOverrideProxy(groupOptions, groupOptionsOverrides)
      : undefined;
  });

  updateComputedValue(renderOptions, () =>
    isDataControl(def)
      ? createOverrideProxy(def.renderOptions ?? {}, renderOptionsOverrides)
      : undefined,
  );

  evalDynamic(
    hidden,
    DynamicPropertyType.Visible,
    // Make sure it's not null if no scripting
    (x) => (x ? def.hidden : !!def.hidden),
    (r) => !r,
  );

  evalDynamic(
    readonly,
    DynamicPropertyType.Readonly,
    () => isControlReadonly(def),
    (r) => !!r,
  );

  createScopedEffect((c) => {
    evalExpr(
      c,
      isControlDisabled(def),
      disabled,
      firstExpr(DynamicPropertyType.Disabled),
      (r) => !!r,
    );
  }, definitionOverrides);

  createScopedEffect((c) => {
    const groupOptions = getGroupRendererOptions(def);
    evalExpr(
      c,
      (groupOptions as GridRendererOptions)?.columns,
      columns,
      groupOptions ? firstExpr(DynamicPropertyType.GridColumns) : undefined,
      (r) => (typeof r === "number" ? r : undefined),
    );
  }, groupOptionsOverrides);

  createScopedEffect((c) => {
    evalExpr(
      c,
      isDataControl(def) ? def.defaultValue : undefined,
      defaultValue,
      isDataControl(def)
        ? firstExpr(DynamicPropertyType.DefaultValue)
        : undefined,
      (r) => r,
    );
  }, definitionOverrides);

  createScopedEffect((c) => {
    evalExpr(
      c,
      isActionControl(def) ? def.actionData : undefined,
      actionData,
      isActionControl(def)
        ? firstExpr(DynamicPropertyType.ActionData)
        : undefined,
      (r) => r,
    );
  }, definitionOverrides);

  createScopedEffect((c) => {
    evalExpr(
      c,
      def.title,
      title,
      firstExpr(DynamicPropertyType.Label),
      coerceString,
    );
  }, definitionOverrides);

  createSyncEffect(() => {
    if (isDisplayControl(def)) {
      if (display.value !== undefined) {
        text.value = isTextDisplay(def.displayData)
          ? display.value
          : NoOverride;
        html.value = isHtmlDisplay(def.displayData)
          ? display.value
          : NoOverride;
      } else {
        text.value = NoOverride;
        html.value = NoOverride;
      }
    }
  }, displayOverrides);

  return createOverrideProxy(def, definitionOverrides);

  function firstExpr(
    property: DynamicPropertyType,
  ): EntityExpression | undefined {
    return def.dynamic?.find((x) => x.type === property && x.expr.type)?.expr;
  }

  function evalDynamic<A>(
    control: Control<A>,
    property: DynamicPropertyType,
    init: (ex: EntityExpression | undefined) => A,
    coerce: (v: unknown) => any,
  ) {
    createScopedEffect((c) => {
      const x = firstExpr(property);
      evalExpr(c, init(x), control, x, coerce);
    }, scope);
  }
}

export function coerceStyle(v: unknown): any {
  return typeof v === "object" ? v : undefined;
}

export function coerceString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  switch (typeof v) {
    case "number":
    case "boolean":
      return v.toString();
    default:
      return JSON.stringify(v);
  }
}

export function createFormStateNode(
  formNode: FormNode,
  parent: SchemaDataNode,
  options: FormGlobalOptions,
  nodeOptions: FormNodeOptions,
): FormStateNodeImpl {
  const globals = newControl<FormGlobalOptions>({
    schemaInterface: options.schemaInterface,
    evalExpression: options.evalExpression,
    runAsync: options.runAsync,
    resolveChildren: options.resolveChildren,
    clearHidden: options.clearHidden,
  });
  return new FormStateNodeImpl(
    "ROOT",
    {},
    formNode.definition,
    formNode,
    nodeOptions,
    globals,
    parent,
    undefined,
    0,
    options.resolveChildren,
  );
}

export interface FormStateBaseImpl extends FormStateBase {
  children: FormStateBaseImpl[];
  allowedOptions?: unknown;
  nodeOptions: FormNodeOptions;
  busy: boolean;
}

export const noopUi: FormNodeUi = {
  ensureChildVisible(childIndex: number) {},
  ensureVisible() {},
  getDisabler(type: ControlDisableType): () => () => void {
    return () => () => {};
  },
};

class FormStateNodeImpl implements FormStateNode {
  readonly base: Control<FormStateBaseImpl>;
  readonly options: Control<FormNodeOptions>;
  readonly resolveChildren: ChildResolverFunc;

  ui = noopUi;

  constructor(
    public childKey: string | number,
    public meta: Record<string, any>,
    definition: ControlDefinition,
    public form: FormNode | undefined | null,
    nodeOptions: FormNodeOptions,
    public readonly globals: Control<FormGlobalOptions>,
    public parent: SchemaDataNode,
    public parentNode: FormStateNode | undefined,
    childIndex: number,
    resolveChildren?: ChildResolverFunc,
  ) {
    const base = newControl<FormStateBaseImpl>(
      {
        readonly: false,
        visible: null,
        disabled: false,
        children: [],
        resolved: { definition } as ResolvedDefinition,
        parent,
        allowedOptions: undefined,
        childIndex,
        nodeOptions,
        busy: false,
      },
      { dontClearError: true },
    );
    this.base = base;
    this.options = base.fields.nodeOptions;
    base.meta["$FormState"] = this;
    this.resolveChildren =
      resolveChildren ?? globals.fields.resolveChildren.value;
    initFormState(definition, this, parentNode);
  }

  get busy() {
    return this.base.fields.busy.value;
  }

  setBusy(busy: boolean) {
    this.base.fields.busy.value = busy;
  }

  get evalExpression(): (
    e: EntityExpression,
    ctx: ExpressionEvalContext,
  ) => void {
    return this.globals.fields.evalExpression.value;
  }

  get runAsync() {
    return this.globals.fields.runAsync.value;
  }

  get schemaInterface(): SchemaInterface {
    return this.globals.fields.schemaInterface.value;
  }

  get forceDisabled() {
    return this.options.fields.forceDisabled.value;
  }

  setForceDisabled(value: boolean) {
    return (this.options.fields.forceDisabled.value = value);
  }

  get forceReadonly() {
    return this.options.fields.forceReadonly.value;
  }
  get forceHidden() {
    return this.options.fields.forceHidden.value;
  }

  attachUi(f: FormNodeUi) {
    this.ui = f;
  }

  get childIndex() {
    return this.base.fields.childIndex.value;
  }

  get children() {
    return this.base.fields.children.elements.map(
      (x) => x.meta["$FormState"] as FormStateNode,
    );
  }

  get uniqueId() {
    return this.base.uniqueId.toString();
  }
  get valid(): boolean {
    return this.base.valid;
  }

  get touched(): boolean {
    return this.base.touched;
  }

  setTouched(touched: boolean, notChildren?: boolean) {
    this.base.setTouched(touched, notChildren);
  }

  validate(): boolean {
    this.children.forEach((child) => {
      child.validate();
    });
    if (this.dataNode) {
      this.dataNode.control.validate();
    }
    return this.valid;
  }

  get readonly() {
    return this.base.fields.readonly.value;
  }

  get visible() {
    return this.base.fields.visible.value;
  }

  get disabled() {
    return this.base.fields.disabled.value;
  }

  get clearHidden() {
    return this.globals.fields.clearHidden.value;
  }

  get variables() {
    return this.options.fields.variables.value;
  }

  get definition() {
    return this.resolved.definition;
  }

  getChild(index: number) {
    return this.base.fields.children.elements[index]?.meta[
      "$FormState"
    ] as FormStateNode;
  }

  getChildCount(): number {
    return this.base.fields.children.elements.length;
  }

  cleanup() {
    this.base.cleanup();
  }

  get resolved() {
    return this.base.fields.resolved.value;
  }

  get dataNode() {
    return this.base.fields.dataNode.value;
  }

  ensureMeta<A>(key: string, init: (scope: CleanupScope) => A): A {
    if (key in this.meta) return this.meta[key];
    const res = init(this.base);
    this.meta[key] = res;
    return res;
  }
}

function initFormState(
  def: ControlDefinition,
  impl: FormStateNodeImpl,
  parentNode: FormStateNode | undefined,
) {
  const {
    base,
    options,
    schemaInterface,
    runAsync,
    evalExpression,
    parent,
    variables,
  } = impl;

  const evalExpr = createEvalExpr(evalExpression, {
    schemaInterface,
    variables,
    dataNode: parent,
    runAsync,
  });

  const scope = base;

  const { forceReadonly, forceDisabled, forceHidden } = options.fields;
  const resolved = base.fields.resolved.as<ResolvedDefinition>();
  const {
    style,
    layoutStyle,
    fieldOptions,
    display,
    definition: rd,
  } = resolved.fields;

  evalDynamic(display, DynamicPropertyType.Display, undefined, coerceString);

  const { dataNode, readonly, disabled, visible, children, allowedOptions } =
    base.fields;

  const definition = createEvaluatedDefinition(def, evalExpr, scope, display);
  rd.value = definition;

  evalDynamic(style, DynamicPropertyType.Style, undefined, coerceStyle);
  evalDynamic(
    layoutStyle,
    DynamicPropertyType.LayoutStyle,
    undefined,
    coerceStyle,
  );
  evalDynamic(
    allowedOptions,
    DynamicPropertyType.AllowedOptions,
    undefined,
    (x) => x,
  );

  updateComputedValue(dataNode, () => lookupDataNode(definition, parent));

  updateComputedValue(visible, () => {
    if (forceHidden.value) return false;
    if (parentNode && !parentNode.visible) return parentNode.visible;
    const dn = dataNode.value;
    if (
      dn &&
      (!validDataNode(dn) || hideDisplayOnly(dn, schemaInterface, definition))
    )
      return false;
    return definition.hidden == null ? null : !definition.hidden;
  });

  updateComputedValue(
    readonly,
    () =>
      parentNode?.readonly ||
      forceReadonly.value ||
      isControlReadonly(definition),
  );
  updateComputedValue(
    disabled,
    () =>
      parentNode?.disabled ||
      forceDisabled.value ||
      isControlDisabled(definition),
  );

  updateComputedValue(fieldOptions, () => {
    const dn = dataNode.value;
    if (!dn) return undefined;
    const fieldOptions = schemaInterface.getDataOptions(dn);
    const _allowed = allowedOptions.value ?? [];
    const allowed = Array.isArray(_allowed) ? _allowed : [_allowed];

    return allowed.length > 0
      ? allowed
          .map((x) =>
            typeof x === "object"
              ? x
              : (fieldOptions?.find((y) => y.value == x) ?? {
                  name: x.toString(),
                  value: x,
                }),
          )
          .filter((x) => x != null)
      : fieldOptions;
  });

  createSyncEffect(() => {
    const dn = dataNode.value;
    if (dn) {
      dn.control.disabled = disabled.value;
    }
  }, scope);

  createSyncEffect(() => {
    const dn = dataNode.value;
    if (dn) {
      dn.control.touched = base.touched;
    }
  }, scope);

  createSyncEffect(() => {
    const dn = dataNode.value;
    if (dn) {
      base.touched = dn.control.touched;
    }
  }, scope);

  createSyncEffect(() => {
    const dn = dataNode.value;
    base.setErrors(dn?.control.errors);
  }, scope);

  setupValidation(
    scope,
    impl.variables,
    definition,
    dataNode,
    schemaInterface,
    parent,
    visible,
    runAsync,
  );

  createSyncEffect(() => {
    const dn = dataNode.value?.control;
    if (dn && isDataControl(definition)) {
      if (definition.hidden) {
        if (impl.clearHidden && !definition.dontClearHidden) {
          // console.log("Clearing hidden");
          dn.value = undefined;
        }
      } else if (
        dn.value === undefined &&
        definition.defaultValue != null &&
        !definition.adornments?.some(
          (x) => x.type === ControlAdornmentType.Optional,
        ) &&
        definition.renderOptions?.type != DataRenderType.NullToggle
      ) {
        // console.log(
        //   "Setting to default",
        //   definition.defaultValue,
        //   definition.field,
        // );
        // const [required, dcv] = isDataControl(definition)
        //   ? [definition.required, definition.defaultValue]
        //   : [false, undefined];
        // const field = ctx.dataNode?.schema.field;
        // return (
        //   dcv ??
        //   (field
        //     ? ctx.dataNode!.elementIndex != null
        //       ? elementValueForField(field)
        //       : defaultValueForField(field, required)
        //     : undefined)
        // );

        dn.value = definition.defaultValue;
      }
    }
  }, scope);

  initChildren(impl);

  function firstExpr(
    property: DynamicPropertyType,
  ): EntityExpression | undefined {
    return def.dynamic?.find((x) => x.type === property && x.expr.type)?.expr;
  }

  function evalDynamic<A>(
    control: Control<A>,
    property: DynamicPropertyType,
    init: A,
    coerce: (v: unknown) => any,
  ) {
    createScopedEffect(
      (c) => evalExpr(c, init, control, firstExpr(property), coerce),
      scope,
    );
  }
}

export function combineVariables(
  v1?: VariablesFunc,
  v2?: VariablesFunc,
): VariablesFunc | undefined {
  if (!v1) return v2;
  if (!v2) return v1;
  return (c) => ({ ...v1(c), ...v2(c) });
}

function initChildren(formImpl: FormStateNodeImpl) {
  const childMap = new Map<any, Control<FormStateBaseImpl>>();
  createSyncEffect(() => {
    const { base, resolveChildren } = formImpl;
    const children = base.fields.children;
    const kids = resolveChildren(formImpl);
    const scope = base;
    const detached = updateElements(children, () =>
      kids.map(({ childKey, create }, childIndex) => {
        let child = childMap.get(childKey);
        if (child) {
          child.fields.childIndex.value = childIndex;
        } else {
          const meta: Record<string, any> = {};
          const cc = create(scope, meta);
          const newOptions: FormNodeOptions = {
            forceHidden: false,
            forceDisabled: false,
            forceReadonly: false,
            variables: combineVariables(formImpl.variables, cc.variables),
          };
          const fsChild = new FormStateNodeImpl(
            childKey,
            meta,
            cc.definition ?? groupedControl([]),
            cc.node === undefined ? formImpl.form : cc.node,
            newOptions,
            formImpl.globals,
            cc.parent ?? formImpl.parent,
            formImpl,
            childIndex,
            cc.resolveChildren,
          );
          child = fsChild.base;
          childMap.set(childKey, child);
        }
        return child;
      }),
    );
    detached.forEach((child) => child.cleanup());
  }, formImpl.base);
}

/**
 * Interface representing the form context data.
 */
export interface FormContextData {
  option?: FieldOption;
  optionSelected?: boolean;
}

export function visitFormState<A>(
  node: FormStateNode,
  visitFn: (node: FormStateNode) => A | undefined,
): A | undefined {
  const v = visitFn(node);
  if (v !== undefined) return v;
  const childCount = node.getChildCount();
  for (let i = 0; i < childCount; i++) {
    const res = visitFormState(node.getChild(i)!, visitFn);
    if (res !== undefined) return res;
  }
  return undefined;
}
