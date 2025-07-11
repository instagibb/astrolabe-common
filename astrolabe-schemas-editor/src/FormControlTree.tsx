import useResizeObserver from "use-resize-observer";
import {
  MoveHandler,
  NodeApi,
  NodeRendererProps,
  Tree,
  TreeApi,
} from "react-arborist";
import {
  addElement,
  Control,
  groupedChanges,
  removeElement,
  unsafeRestoreControl,
  updateElements,
  useControl,
} from "@react-typed-forms/core";
import { defaultControlDefinitionForm } from "./schemaSchemas";
import React, { Fragment, Key, MutableRefObject, useEffect } from "react";
import clsx from "clsx";
import {
  ControlDefinition,
  ControlDefinitionType,
  fieldPathForDefinition,
  FormNode,
  groupedControl,
  isDataControl,
  schemaForDataPath,
  schemaForFieldPath,
  SchemaNode,
} from "@react-typed-forms/schemas";
import { ControlNode, SelectedControlNode } from "./types";
import { StdTreeNode } from "./StdTreeNode";
import { canAddChildren } from "./util";
import { EditorFormTree } from "./EditorFormTree";
import { Menu } from "./components/Menu";
import { paste } from "./controlActions";
import { MenuItem } from "./components/MenuItem";
import { isControlOnClipboard } from "./clipboard";
import { Button, MenuTrigger } from "react-aria-components";
import { Popover } from "./components/Popover";

export interface FormControlTreeProps {
  className?: string;
  tree: EditorFormTree;
  rootSchema: SchemaNode;
  selectedControl: Control<SelectedControlNode | undefined>;
  selected: Control<string | undefined>;
  selectedField: Control<SchemaNode | undefined>;
  onDeleted: (n: NodeApi<ControlNode>) => void;
  treeApi?: MutableRefObject<TreeApi<ControlNode> | null>;
}

export function FormControlTree({
  tree,
  selected,
  selectedControl,
  rootSchema,
  selectedField,
  onDeleted,
  className,
  treeApi,
}: FormControlTreeProps) {
  const { ref, width, height } = useResizeObserver();
  const rootNodes = tree.getEditableChildren(tree.rootNode);
  const treeNodes = tree.rootNode
    .getUnresolvedChildNodes()
    .map((x) => toControlNode(x, rootSchema));

  function getDefinitionControl(
    x: NodeApi<ControlNode>,
  ): Control<ControlDefinition> {
    return unsafeRestoreControl(x.data.form.definition)!;
  }

  const doMove: MoveHandler<ControlNode> = (props) => {
    groupedChanges(() => {
      const parentChildren =
        props.parentId === null
          ? rootNodes
          : tree.getEditableChildren(props.parentNode?.data?.form);
      if (parentChildren) {
        props.dragNodes.forEach((x) => {
          const parentControl =
            x.level === 0
              ? rootNodes
              : tree.getEditableChildren(x.parent!.data.form);
          if (parentControl) {
            updateElements(parentControl, (e) =>
              e.filter((c) => c !== getDefinitionControl(x)),
            );
          }
        });
        updateElements(parentChildren, (e) => {
          const c = [...e];
          c.splice(
            props.index,
            0,
            ...props.dragNodes.map((x) => getDefinitionControl(x)),
          );
          return c;
        });
      }
    });
  };
  return (
    <div className={className} ref={ref}>
      <Tree<ControlNode>
        ref={treeApi}
        width={width}
        height={height}
        onSelect={onSelect}
        data={treeNodes}
        selection={selected.value}
        children={ControlNodeRenderer}
        onCreate={(props) => {
          if (props.parentNode) {
            const childElements = tree.getEditableChildren(
              props.parentNode.data.form,
            );
            if (childElements) {
              const c = addElement(childElements, defaultControlDefinitionForm);
              return { id: c.uniqueId.toString() };
            }
          }
          return null;
        }}
        onMove={doMove}
        onDelete={(props) => {
          props.nodes.forEach((x) => {
            const parentElements =
              x.level == 0
                ? rootNodes
                : tree.getEditableChildren(x.parent!.data?.form);
            if (parentElements) {
              removeElement(parentElements, getDefinitionControl(x));
              onDeleted(x);
            }
          });
        }}
      />
    </div>
  );

  function onSelect(n: NodeApi<ControlNode>[]) {
    groupedChanges(() => {
      const f = n[0];
      selected.value = n[0]?.id;
      if (f) {
        selectedControl.value = {
          form: f.data.form,
          schema: f.data.schema,
        };
        const schemaPath = fieldPathForDefinition(f.data.form.definition);
        if (schemaPath) {
          selectedField.value = schemaForDataPath(
            schemaPath,
            f.data.schema,
          ).node;
        }
      } else {
        selectedControl.value = undefined;
        selectedField.value = undefined;
      }
    });
  }

  function toControlNode(
    form: FormNode,
    parentSchema: SchemaNode,
  ): ControlNode {
    const def = form.definition;
    const childPath = fieldPathForDefinition(def);
    const dataSchema = childPath
      ? schemaForFieldPath(childPath, parentSchema)
      : undefined;
    const c = form.getUnresolvedChildNodes();
    const children =
      c.length == 0 && !canAddChildren(def, dataSchema)
        ? null
        : c.map((x) => toControlNode(x, dataSchema ?? parentSchema));
    return {
      id: form.id,
      form,
      dataSchema,
      schema: parentSchema,
      children,
    };
  }
}

function ControlNodeRenderer(props: NodeRendererProps<ControlNode>) {
  const { node, tree } = props;
  const canDelete = true;
  const formNode = node.data.form;
  const control = formNode.definition;
  const canAdd = canAddChildren(control, node.data.dataSchema);
  return (
    <StdTreeNode {...props}>
      <i className={clsx("fa-solid w-4 h-4 mr-2", nodeIcon(control.type))} />
      <span className="truncate">
        {control.title}
        {isDataControl(control) ? (
          <span>
            {" "}
            <i>({control.field})</i>
          </span>
        ) : (
          ""
        )}
      </span>
      {canAdd && (
        <i
          className="ml-2 fa-solid fa-plus w-4 h-4"
          onClick={async (e) => {
            e.stopPropagation();
            await node.tree.create({ parentId: node.id });
          }}
        />
      )}
      {canDelete && (
        <i
          className="ml-2 fa-solid fa-remove w-4 h-4"
          onClick={async (e) => {
            e.stopPropagation();
            await node.tree.delete(node);
          }}
        />
      )}
      <MenuTrigger>
        <Button>
          <i className="pl-2 fa fa-ellipsis-vertical text-xs" />
        </Button>
        <Popover>
          <ControlMenu node={node} tree={tree} />
        </Popover>
      </MenuTrigger>
    </StdTreeNode>
  );

  function nodeIcon(t: string) {
    switch (t) {
      case ControlDefinitionType.Data:
        return "fa-pen";
      case ControlDefinitionType.Display:
        return "fa-text";
      case ControlDefinitionType.Action:
        return "fa-bolt";
      case ControlDefinitionType.Group:
        return "fa-layer-group";
      default:
        return "fa-question";
    }
  }
}

function ControlMenu({
  tree,
  node,
}: {
  tree: TreeApi<ControlNode>;
  node: NodeApi<ControlNode>;
}) {
  const formNode = node.data.form;
  const showPaste = useControl(false);
  useEffect(() => {
    checkClipboard();
  }, []);

  return (
    <Menu onAction={doAction}>
      <MenuItem id="wrapGroup">Wrap with group</MenuItem>
      {showPaste.value && (
        <>
          <MenuItem id="paste">Paste as child</MenuItem>
          <MenuItem id="pasteBefore">Paste before</MenuItem>
          <MenuItem id="pasteAfter">Paste after</MenuItem>
        </>
      )}
    </Menu>
  );

  async function checkClipboard() {
    showPaste.value = await isControlOnClipboard();
  }

  function doAction(id: Key) {
    const editorTree = formNode.tree as EditorFormTree;
    groupedChanges(() => {
      switch (id) {
        case "paste":
          paste(editorTree, formNode);
          break;
        case "pasteBefore":
          paste(editorTree, formNode.parent!, formNode, false);
          break;
        case "pasteAfter":
          paste(editorTree, formNode.parent!, formNode, true);
          break;
        case "wrapGroup":
          wrapGroupAction();
          break;
      }
    });

    function wrapGroupAction() {
      const def = editorTree.getEditableDefinition(formNode);
      if (def) {
        def.setValue((x) => groupedControl([def.value]));
      }
    }
  }
}
