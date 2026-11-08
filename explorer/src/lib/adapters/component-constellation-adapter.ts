import type {
  ExplorerDataSchema,
  ExplorerNode,
  ExplorerEdge,
  ExplorerNodeType,
  ExplorerRelationshipType,
} from '../../types/explorer';
import { computeGraphDepths } from '../graph-depth';
import { DEFAULT_COMPONENT_ORBIT_EDGE_TYPES } from './component-orbit-adapter';

export const CONTRACTED_INNER_SUN_IDS: string[] = [
  'LWC:asset-dashboard-container',
  'LWC:asset-management-dashboard',
  'LWC:citizen-complaint-list',
  'LWC:vendor-assignment-panel',
  'LWC:vendor-workspace',
  'LWC:zone-manager-dashboard',
];

export const CONTRACTED_OUTER_SUN_IDS: string[] = [
  'LWC:approval-flow',
  'LWC:budget-utilization-summary',
  'LWC:citizen-report-portal',
  'LWC:dynamic-inspection-form',
  'LWC:engineer-workload-dashboard',
  'LWC:error-panel',
  'LWC:maintenance-request-kanban',
  'LWC:notification-center',
];

export const CONTRACTED_14_SUN_IDS: string[] = [
  ...CONTRACTED_INNER_SUN_IDS,
  ...CONTRACTED_OUTER_SUN_IDS,
];

export type ComponentConstellationRoleSymbol = '☉' | '◎' | '◉' | '○';

export interface ComponentConstellationNode {
  nodeId: string;
  displayName: string;
  type: ExplorerNodeType;
  file: string;
  risk: string;
  roleSymbol: ComponentConstellationRoleSymbol;
  isSun: boolean;
  sunRing: 'inner' | 'outer' | null;
  isChildLwc: boolean;
  isSharedNode: boolean;
  referencingSunIds: string[];
  metrics: {
    fanIn: number;
    fanOut: number;
    coupling: number;
    score: number;
  };
  provenance: {
    sourceGraphNodeId: string;
    nodeType: string;
  };
}

export interface ComponentConstellationEdgeProvenance {
  sourceEdgeId: string;
  sourceComponentName: string;
  targetComponentName: string;
  relationshipType: string;
}

export interface ComponentConstellationEdge {
  edgeId: string;
  source: string;
  target: string;
  relationshipType: ExplorerRelationshipType | string;
  isCompositionEdge: boolean;
  isControllerEdge: boolean;
  provenance: ComponentConstellationEdgeProvenance;
}

export interface ComponentConstellationSummary {
  sunCount: number;
  innerSunCount: number;
  outerSunCount: number;
  totalOccurrences: number;
  totalUniqueNodes: number;
  sharedNodeCount: number;
  totalEdges: number;
}

export interface ComponentConstellationAdapterOptions {
  customSunIds?: string[];
  includeTestReferences?: boolean;
}

export interface ComponentConstellationProjection {
  suns: ComponentConstellationNode[];
  innerSuns: ComponentConstellationNode[];
  outerSuns: ComponentConstellationNode[];
  nodes: Record<string, ComponentConstellationNode>;
  edges: ComponentConstellationEdge[];
  sharedNodeIds: string[];
  summary: ComponentConstellationSummary;
  options: ComponentConstellationAdapterOptions;
}

/**
 * Pure, deterministic semantic adapter for Multi-Sun Component Constellation.
 * Combines k=1 local orbit projections around 14 authoritative Sun LWCs.
 * Enforces zero node cloning, identity conservation, 100% edge preservation,
 * and deterministic identification of shared k=1 nodes across Suns.
 */
export function adaptComponentConstellation(
  input: ExplorerDataSchema,
  options: ComponentConstellationAdapterOptions = {}
): ComponentConstellationProjection {
  const rawNodes = Array.isArray(input?.nodes) ? input.nodes : [];
  const rawEdges = Array.isArray(input?.edges) ? input.edges : [];

  // Deterministic sorting of input graphs
  const nodes: ExplorerNode[] = [...rawNodes].sort((a, b) => a.id.localeCompare(b.id));
  const edges: ExplorerEdge[] = [...rawEdges].sort((a, b) => {
    const sDiff = a.source.localeCompare(b.source);
    if (sDiff !== 0) return sDiff;
    const tDiff = a.target.localeCompare(b.target);
    if (tDiff !== 0) return tDiff;
    const rDiff = (a.relationshipType || '').localeCompare(b.relationshipType || '');
    if (rDiff !== 0) return rDiff;
    return (a.id || '').localeCompare(b.id || '');
  });

  const nodeMap = new Map<string, ExplorerNode>();
  nodes.forEach((n) => nodeMap.set(n.id, n));

  // Determine initial Sun set
  const innerSunSet = new Set<string>();
  const outerSunSet = new Set<string>();
  const activeSunIds: string[] = [];

  const targetSunList = options.customSunIds || CONTRACTED_14_SUN_IDS;

  // Filter requested Suns that exist in input nodes and are LWCs
  targetSunList.forEach((id) => {
    if (nodeMap.has(id) && nodeMap.get(id)!.type === 'LWC') {
      activeSunIds.push(id);
      if (CONTRACTED_INNER_SUN_IDS.includes(id)) {
        innerSunSet.add(id);
      } else if (CONTRACTED_OUTER_SUN_IDS.includes(id)) {
        outerSunSet.add(id);
      } else {
        // Fallback categorization if custom Sun list is passed
        if (innerSunSet.size < 6) {
          innerSunSet.add(id);
        } else {
          outerSunSet.add(id);
        }
      }
    }
  });

  // If targetSunList did not yield 14 Suns (e.g. non-PBIM project or partial match),
  // supplement with available LWCs ranked deterministically up to 14 Suns.
  if (!options.customSunIds && activeSunIds.length < 14) {
    const parentToChildLwcsMap = new Map<string, Set<string>>();
    const childToParentLwcsMap = new Map<string, Set<string>>();
    const outgoingEdgeCountMap = new Map<string, number>();

    edges.forEach((edge) => {
      const sNode = nodeMap.get(edge.source);
      const tNode = nodeMap.get(edge.target);
      if (sNode?.type === 'LWC') {
        outgoingEdgeCountMap.set(edge.source, (outgoingEdgeCountMap.get(edge.source) || 0) + 1);
        if (tNode?.type === 'LWC' && edge.relationshipType === 'lwc-template-child') {
          if (!parentToChildLwcsMap.has(edge.source)) {
            parentToChildLwcsMap.set(edge.source, new Set());
          }
          parentToChildLwcsMap.get(edge.source)!.add(edge.target);

          if (!childToParentLwcsMap.has(edge.target)) {
            childToParentLwcsMap.set(edge.target, new Set());
          }
          childToParentLwcsMap.get(edge.target)!.add(edge.source);
        }
      }
    });

    const activeSet = new Set(activeSunIds);
    const candidateLwcs = nodes.filter(
      (n) => n.type === 'LWC' && !activeSet.has(n.id) && !n.file?.includes('.test.') && !n.file?.includes('__tests__')
    );

    candidateLwcs
      .map((lwc) => {
        const childLwcs = parentToChildLwcsMap.get(lwc.id);
        const childLwcCount = childLwcs ? childLwcs.size : 0;
        const parents = childToParentLwcsMap.get(lwc.id);
        const isRootLwc = !parents || parents.size === 0;
        const outCount = outgoingEdgeCountMap.get(lwc.id) || 0;
        return {
          id: lwc.id,
          childLwcCount,
          totalDependencyCount: outCount,
          isRootLwc,
        };
      })
      .sort((a, b) => {
        if (a.isRootLwc !== b.isRootLwc) return a.isRootLwc ? -1 : 1;
        if (b.totalDependencyCount !== a.totalDependencyCount) {
          return b.totalDependencyCount - a.totalDependencyCount;
        }
        if (b.childLwcCount !== a.childLwcCount) {
          return b.childLwcCount - a.childLwcCount;
        }
        return a.id.localeCompare(b.id);
      })
      .forEach((cand) => {
        if (activeSunIds.length < 14) {
          activeSunIds.push(cand.id);
          if (innerSunSet.size < 6) {
            innerSunSet.add(cand.id);
          } else {
            outerSunSet.add(cand.id);
          }
        }
      });
  }

  const allowedEdgeTypes = new Set(DEFAULT_COMPONENT_ORBIT_EDGE_TYPES);
  if (options.includeTestReferences) {
    allowedEdgeTypes.add('test-reference');
  }

  // Map each Sun to its k=1 reachable direct dependencies
  const sunReachableNodesMap = new Map<string, Set<string>>();
  const nodeReferencingSunsMap = new Map<string, Set<string>>();
  let totalOccurrences = 0;

  activeSunIds.forEach((sunId) => {
    const depthResult = computeGraphDepths(nodes, edges, sunId, {
      maxDepth: 1,
      direction: 'dependencies',
      allowedEdgeTypes,
    });

    const reachableSet = new Set(depthResult.reachableNodeIds);
    sunReachableNodesMap.set(sunId, reachableSet);

    reachableSet.forEach((nodeId) => {
      totalOccurrences++;
      if (!nodeReferencingSunsMap.has(nodeId)) {
        nodeReferencingSunsMap.set(nodeId, new Set());
      }
      nodeReferencingSunsMap.get(nodeId)!.add(sunId);
    });
  });

  // Build projected nodes map - Ensure every active Sun is included unconditionally
  const projectedNodesDict: Record<string, ComponentConstellationNode> = {};
  const sharedNodeIdsSet = new Set<string>();

  activeSunIds.forEach((sunId) => {
    const rawNode = nodeMap.get(sunId);
    if (!rawNode) return;

    const sunRing = innerSunSet.has(sunId) ? 'inner' : 'outer';
    const referencingSuns = nodeReferencingSunsMap.get(sunId);
    const sunsList = referencingSuns ? Array.from(referencingSuns).sort((a, b) => a.localeCompare(b)) : [];

    projectedNodesDict[sunId] = {
      nodeId: rawNode.id,
      displayName: rawNode.displayName || rawNode.id,
      type: rawNode.type,
      file: rawNode.file,
      risk: rawNode.risk,
      roleSymbol: '☉',
      isSun: true,
      sunRing,
      isChildLwc: false,
      isSharedNode: false,
      referencingSunIds: sunsList,
      metrics: {
        fanIn: rawNode.metrics?.fanIn ?? 0,
        fanOut: rawNode.metrics?.fanOut ?? 0,
        coupling: rawNode.metrics?.coupling ?? 0,
        score: rawNode.metrics?.score ?? 0,
      },
      provenance: {
        sourceGraphNodeId: rawNode.id,
        nodeType: rawNode.type,
      },
    };
  });

  nodeReferencingSunsMap.forEach((sunsSet, nodeId) => {
    if (projectedNodesDict[nodeId]) return; // Already populated as Sun

    const rawNode = nodeMap.get(nodeId);
    if (!rawNode) return;

    const sunsList = Array.from(sunsSet).sort((a, b) => a.localeCompare(b));
    const isSun = activeSunIds.includes(nodeId);
    const sunRing = isSun ? (innerSunSet.has(nodeId) ? 'inner' : 'outer') : null;
    const isSharedNode = !isSun && sunsList.length >= 2;
    if (isSharedNode) {
      sharedNodeIdsSet.add(nodeId);
    }

    const isChildLwc = !isSun && rawNode.type === 'LWC';

    // Assign role symbol:
    // ☉ = Sun (Initial LWC Sun)
    // ◎ = Child LWC
    // ◉ = Shared Node (Apex or LWC referenced by >= 2 Suns)
    // ○ = Ordinary dependency
    let roleSymbol: ComponentConstellationRoleSymbol = '○';
    if (isSun) {
      roleSymbol = '☉';
    } else if (isSharedNode) {
      roleSymbol = '◉';
    } else if (isChildLwc) {
      roleSymbol = '◎';
    }

    projectedNodesDict[nodeId] = {
      nodeId: rawNode.id,
      displayName: rawNode.displayName || rawNode.id,
      type: rawNode.type,
      file: rawNode.file,
      risk: rawNode.risk,
      roleSymbol,
      isSun,
      sunRing,
      isChildLwc,
      isSharedNode,
      referencingSunIds: sunsList,
      metrics: {
        fanIn: rawNode.metrics?.fanIn ?? 0,
        fanOut: rawNode.metrics?.fanOut ?? 0,
        coupling: rawNode.metrics?.coupling ?? 0,
        score: rawNode.metrics?.score ?? 0,
      },
      provenance: {
        sourceGraphNodeId: rawNode.id,
        nodeType: rawNode.type,
      },
    };
  });

  // Collect projected Suns
  const sunsNodes: ComponentConstellationNode[] = [];
  const innerSunsNodes: ComponentConstellationNode[] = [];
  const outerSunsNodes: ComponentConstellationNode[] = [];

  activeSunIds.forEach((sunId) => {
    const nodeObj = projectedNodesDict[sunId];
    if (nodeObj) {
      sunsNodes.push(nodeObj);
      if (nodeObj.sunRing === 'inner') {
        innerSunsNodes.push(nodeObj);
      } else {
        outerSunsNodes.push(nodeObj);
      }
    }
  });

  // Collect authoritative edges among projected nodes
  const projectedSet = new Set(Object.keys(projectedNodesDict));
  const projectedEdges: ComponentConstellationEdge[] = [];

  edges.forEach((edge, index) => {
    if (projectedSet.has(edge.source) && projectedSet.has(edge.target)) {
      if (!allowedEdgeTypes.has(edge.relationshipType)) return;

      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);
      const edgeId = edge.id || `constellation_edge_${edge.source}_${edge.target}_${index}`;

      projectedEdges.push({
        edgeId,
        source: edge.source,
        target: edge.target,
        relationshipType: edge.relationshipType,
        isCompositionEdge: edge.relationshipType === 'lwc-template-child',
        isControllerEdge: edge.relationshipType === 'lwc-apex',
        provenance: {
          sourceEdgeId: edge.id || edgeId,
          sourceComponentName: sourceNode?.displayName || edge.source,
          targetComponentName: targetNode?.displayName || edge.target,
          relationshipType: edge.relationshipType,
        },
      });
    }
  });

  const sharedNodeIds = Array.from(sharedNodeIdsSet).sort((a, b) => a.localeCompare(b));

  return {
    suns: sunsNodes,
    innerSuns: innerSunsNodes,
    outerSuns: outerSunsNodes,
    nodes: projectedNodesDict,
    edges: projectedEdges,
    sharedNodeIds,
    summary: {
      sunCount: sunsNodes.length,
      innerSunCount: innerSunsNodes.length,
      outerSunCount: outerSunsNodes.length,
      totalOccurrences,
      totalUniqueNodes: Object.keys(projectedNodesDict).length,
      sharedNodeCount: sharedNodeIds.length,
      totalEdges: projectedEdges.length,
    },
    options,
  };
}
