import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import * as d3 from 'd3';
import { Telemetry } from '../../services/telemetry';
import { Device, DeviceCategory } from '../../models/telemetry.models';

interface TopologyNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  model: string;
  type: 'coordinator' | 'zigbee' | 'wifi';
  category?: DeviceCategory;
  address: string; // IEEE address or IP
  battery?: number | null;
  lqi?: number | null;
  state?: string | null;
  temp?: number | null;
  hum?: number | null;
  fanSpeed?: number | string | null;
  power?: number | null;
  isCoordinator?: boolean;
  deviceRef?: Device;
}

interface TopologyLink extends d3.SimulationLinkDatum<TopologyNode> {
  type: 'zigbee' | 'wifi';
  lqi?: number | null;
  ip?: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-topology-graph',
  imports: [MatIconModule],
  template: `
    <div class="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4 relative overflow-hidden shadow-2xl">
      <!-- Nagłówek Sekcji Topologii -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div class="space-y-1">
          <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-gradient-to-r from-cyan-500/10 to-indigo-500/10 text-cyan-300 border border-cyan-500/20">
            <mat-icon class="text-sm !w-4 !h-4">hub</mat-icon>
            <span>Interaktywny Graf Topologii Sieci D3.js</span>
          </div>
          <h3 class="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            Topologia Hybrydowa: Sonoff Dongle Max + Zigbee Mesh & Wi-Fi
          </h3>
          <p class="text-xs text-slate-400">
            Centralny punkt: <strong class="text-cyan-300 font-mono">Sonoff Dongle Max (EFR32MG24)</strong> • Podział na strefę Zigbee 3.0 oraz Wi-Fi LAN
          </p>
        </div>

        <!-- Filtry i Przyciski Sterujące Widokiem -->
        <div class="flex flex-wrap items-center gap-2 shrink-0">
          <div class="flex items-center p-1 rounded-xl bg-slate-950 border border-slate-800 text-xs font-semibold">
            <button
              (click)="selectedFilter.set('all')"
              class="px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
              [class.bg-slate-800]="selectedFilter() === 'all'"
              [class.text-white]="selectedFilter() === 'all'"
              [class.text-slate-400]="selectedFilter() !== 'all'"
            >
              Wszystkie ({{ nodesCount() }})
            </button>
            <button
              (click)="selectedFilter.set('zigbee')"
              class="px-2.5 py-1 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
              [class.bg-cyan-500/20]="selectedFilter() === 'zigbee'"
              [class.text-cyan-300]="selectedFilter() === 'zigbee'"
              [class.text-slate-400]="selectedFilter() !== 'zigbee'"
            >
              <span class="w-2 h-2 rounded-full bg-cyan-400"></span>
              <span>Zigbee Mesh</span>
            </button>
            <button
              (click)="selectedFilter.set('wifi')"
              class="px-2.5 py-1 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
              [class.bg-indigo-500/20]="selectedFilter() === 'wifi'"
              [class.text-indigo-300]="selectedFilter() === 'wifi'"
              [class.text-slate-400]="selectedFilter() !== 'wifi'"
            >
              <span class="w-2 h-2 rounded-full bg-indigo-400"></span>
              <span>Wi-Fi LAN</span>
            </button>
          </div>

          <button
            (click)="resetZoom()"
            class="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
            title="Resetuj widok grafu"
          >
            <mat-icon class="text-sm !w-4 !h-4">center_focus_strong</mat-icon>
          </button>
        </div>
      </div>

      <!-- Legenda Stref: ZigBee vs Wi-Fi -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
        <div class="p-3 rounded-xl bg-cyan-950/20 border border-cyan-800/40 flex items-center justify-between">
          <div class="flex items-center gap-2 text-cyan-300">
            <span class="w-3 h-3 rounded-full bg-cyan-400 animate-pulse"></span>
            <span class="font-bold">Strefa 1: Sieć Zigbee 3.0 Mesh</span>
          </div>
          <span class="text-slate-400 text-[11px]">Koordynator EFR32MG24</span>
        </div>

        <div class="p-3 rounded-xl bg-indigo-950/20 border border-indigo-800/40 flex items-center justify-between">
          <div class="flex items-center gap-2 text-indigo-300">
            <span class="w-3 h-3 rounded-full bg-indigo-400 animate-pulse"></span>
            <span class="font-bold">Strefa 2: Sieć Wi-Fi / IP LAN</span>
          </div>
          <span class="text-slate-400 text-[11px]">Czyste Wi-Fi SmartConfig</span>
        </div>
      </div>

      <!-- Kontener Grafu SVG D3 -->
      <div class="relative w-full h-[480px] bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden">
        <svg #svgCanvas class="w-full h-full cursor-grab active:cursor-grabbing"></svg>

        <!-- Pływający Dymek Hosta (Hover/Selection Tooltip) -->
        @if (selectedNode(); as node) {
          <div
            class="absolute top-4 right-4 z-20 w-80 p-4 rounded-2xl bg-slate-900/95 border border-slate-700 shadow-2xl backdrop-blur-md space-y-3 animate-fade-in"
          >
            <div class="flex items-start justify-between gap-2 border-b border-slate-800 pb-2.5">
              <div>
                <div class="flex items-center gap-1.5 mb-0.5">
                  <span
                    class="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded border"
                    [class.bg-cyan-500/10]="node.type === 'zigbee' || node.type === 'coordinator'"
                    [class.text-cyan-400]="node.type === 'zigbee' || node.type === 'coordinator'"
                    [class.border-cyan-500/20]="node.type === 'zigbee' || node.type === 'coordinator'"
                    [class.bg-indigo-500/10]="node.type === 'wifi'"
                    [class.text-indigo-400]="node.type === 'wifi'"
                    [class.border-indigo-500/20]="node.type === 'wifi'"
                  >
                    {{ node.type === 'coordinator' ? 'Koordynator' : (node.type === 'zigbee' ? 'ZigBee 3.0' : 'Wi-Fi LAN') }}
                  </span>
                  <span class="text-[10px] font-mono text-slate-400">{{ node.model }}</span>
                </div>
                <h4 class="text-sm font-bold text-white tracking-tight">{{ node.name }}</h4>
              </div>
              <button
                (click)="selectedNode.set(null)"
                class="text-slate-400 hover:text-white cursor-pointer"
              >
                <mat-icon class="text-sm !w-4 !h-4">close</mat-icon>
              </button>
            </div>

            <div class="space-y-1.5 font-mono text-xs">
              <div class="flex justify-between text-slate-300">
                <span class="text-slate-500">Adres ID / IP:</span>
                <span class="text-cyan-300">{{ node.address }}</span>
              </div>

              @if (node.type === 'zigbee' && node.lqi !== undefined && node.lqi !== null) {
                <div class="flex justify-between text-slate-300">
                  <span class="text-slate-500">Jakość sygnału LQI:</span>
                  <span class="text-emerald-400 font-bold">{{ node.lqi }} / 255</span>
                </div>
              }

              @if (node.battery !== undefined && node.battery !== null) {
                <div class="flex justify-between text-slate-300">
                  <span class="text-slate-500">Poziom Baterii:</span>
                  <span [class.text-rose-400]="node.battery <= 15" [class.text-emerald-400]="node.battery > 15">
                    {{ node.battery }}%
                  </span>
                </div>
              }

              @if (node.temp !== undefined && node.temp !== null) {
                <div class="flex justify-between text-slate-300">
                  <span class="text-slate-500">Temperatura:</span>
                  <span class="text-amber-400 font-bold">{{ node.temp }}°C</span>
                </div>
              }

              @if (node.hum !== undefined && node.hum !== null) {
                <div class="flex justify-between text-slate-300">
                  <span class="text-slate-500">Wilgotność:</span>
                  <span class="text-cyan-400 font-bold">{{ node.hum }}%</span>
                </div>
              }

              @if (node.state) {
                <div class="flex justify-between text-slate-300">
                  <span class="text-slate-500">Stan zasilania:</span>
                  <span class="text-emerald-400 font-bold">{{ node.state }}</span>
                </div>
              }

              @if (node.fanSpeed) {
                <div class="flex justify-between text-slate-300">
                  <span class="text-slate-500">Bieg wentylatora:</span>
                  <span class="text-indigo-300 font-bold">{{ node.fanSpeed }} / 12</span>
                </div>
              }
            </div>

            @if (node.deviceRef) {
              <div class="pt-2 border-t border-slate-800 flex justify-end">
                <button
                  (click)="inspectDevice(node.deviceRef)"
                  class="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  Steruj w panelu →
                </button>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class TopologyGraph implements OnInit, OnDestroy {
  readonly telemetry = inject(Telemetry);
  readonly selectDevice = output<Device>();

  readonly svgCanvas = viewChild<ElementRef<SVGSVGElement>>('svgCanvas');

  readonly selectedFilter = signal<'all' | 'zigbee' | 'wifi'>('all');
  readonly selectedNode = signal<TopologyNode | null>(null);

  readonly nodesCount = computed(() => this.telemetry.devices().length + 1);

  private simulation: d3.Simulation<TopologyNode, TopologyLink> | null = null;
  private zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
  private svgG: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;

  ngOnInit(): void {
    setTimeout(() => this.renderGraph(), 100);
  }

  ngOnDestroy(): void {
    if (this.simulation) {
      this.simulation.stop();
    }
  }

  resetZoom(): void {
    const svgEl = this.svgCanvas()?.nativeElement;
    if (svgEl && this.zoomBehavior) {
      d3.select(svgEl).transition().duration(750).call(this.zoomBehavior.transform, d3.zoomIdentity);
    }
  }

  inspectDevice(dev?: Device): void {
    if (dev) {
      this.selectDevice.emit(dev);
    }
  }

  private renderGraph(): void {
    const svgEl = this.svgCanvas()?.nativeElement;
    if (!svgEl) return;

    d3.select(svgEl).selectAll('*').remove();

    const width = svgEl.clientWidth || 900;
    const height = svgEl.clientHeight || 480;

    const svg = d3.select(svgEl);

    // Definicja cieni i gradientów
    const defs = svg.append('defs');

    // Gradient dla Koordynatora Sonoff Dongle Max
    const coordGrad = defs.append('radialGradient').attr('id', 'coordGrad');
    coordGrad.append('stop').attr('offset', '0%').attr('stop-color', '#06b6d4');
    coordGrad.append('stop').attr('offset', '100%').attr('stop-color', '#0284c7');

    // Shadow filter
    const glowFilter = defs.append('filter').attr('id', 'glow').attr('x', '-20%').attr('y', '-20%').attr('width', '140%').attr('height', '140%');
    glowFilter.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur');
    glowFilter.append('feComposite').attr('in', 'SourceGraphic').attr('in2', 'blur').attr('operator', 'over');

    // Pętla powiększania / przesuwania (Zoom & Pan)
    const g = svg.append('g');
    this.svgG = g;

    this.zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(this.zoomBehavior);

    // Tło strefowe (ZigBee Left / Wi-Fi Right)
    g.append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', width / 2)
      .attr('height', height)
      .attr('fill', 'rgba(6, 182, 212, 0.03)')
      .attr('stroke', 'rgba(6, 182, 212, 0.1)')
      .attr('stroke-dasharray', '4,4');

    g.append('rect')
      .attr('x', width / 2)
      .attr('y', 0)
      .attr('width', width / 2)
      .attr('height', height)
      .attr('fill', 'rgba(99, 102, 241, 0.03)')
      .attr('stroke', 'rgba(99, 102, 241, 0.1)')
      .attr('stroke-dasharray', '4,4');

    // Etykiety Stref
    g.append('text')
      .attr('x', 20)
      .attr('y', 30)
      .attr('fill', '#22d3ee')
      .attr('font-size', '11px')
      .attr('font-family', 'monospace')
      .attr('font-weight', 'bold')
      .text('STREFA ZIGBEE 3.0 MESH');

    g.append('text')
      .attr('x', width / 2 + 20)
      .attr('y', 30)
      .attr('fill', '#818cf8')
      .attr('font-size', '11px')
      .attr('font-family', 'monospace')
      .attr('font-weight', 'bold')
      .text('STREFA WI-FI LAN (SMARTCONFIG)');

    // Budowa węzłów i połączeń
    const coordinatorNode: TopologyNode = {
      id: 'sonoff-dongle-max',
      name: 'Sonoff Dongle Max',
      model: 'EFR32MG24 Coordinator',
      type: 'coordinator',
      address: 'Port: 6638 / ember',
      isCoordinator: true,
      x: width / 2,
      y: height / 2,
      fx: width / 2,
      fy: height / 2,
    };

    const deviceNodes: TopologyNode[] = this.telemetry.devices().map((d) => {
      const isWifi = d.ieee_address.startsWith('wifi_') || d.model.toLowerCase().includes('gow') || d.model.toLowerCase().includes('wifi');
      return {
        id: d.ieee_address,
        name: d.friendly_name || d.model,
        model: d.model,
        type: isWifi ? 'wifi' : 'zigbee',
        category: d.category,
        address: d.ieee_address,
        battery: d.battery,
        lqi: d.linkquality,
        state: d.state,
        temp: d.last_temperature,
        hum: d.last_humidity,
        fanSpeed: d.fan_speed,
        power: d.power,
        deviceRef: d,
      };
    });

    const activeFilter = this.selectedFilter();
    let filteredDevices = deviceNodes;
    if (activeFilter === 'zigbee') {
      filteredDevices = deviceNodes.filter((n) => n.type === 'zigbee');
    } else if (activeFilter === 'wifi') {
      filteredDevices = deviceNodes.filter((n) => n.type === 'wifi');
    }

    const allNodes = [coordinatorNode, ...filteredDevices];

    const links: TopologyLink[] = filteredDevices.map((d) => ({
      source: coordinatorNode.id,
      target: d.id,
      type: d.type === 'wifi' ? 'wifi' : 'zigbee',
      lqi: d.lqi,
      ip: d.address,
    }));

    // Konfiguracja symulacji sił D3
    this.simulation = d3.forceSimulation<TopologyNode, TopologyLink>(allNodes)
      .force('link', d3.forceLink<TopologyNode, TopologyLink>(links).id((d) => d.id).distance(140))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('collision', d3.forceCollide().radius(45))
      .force('x', d3.forceX<TopologyNode>((d) => {
        if (d.isCoordinator) return width / 2;
        return d.type === 'zigbee' ? width / 4 : (width * 3) / 4;
      }).strength(0.3))
      .force('y', d3.forceY(height / 2).strength(0.2));

    // Rysowanie krawędzi (Połączeń)
    const linkGroup = g.append('g').attr('class', 'links');
    const linkElements = linkGroup
      .selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('stroke', (d) => (d.type === 'wifi' ? '#6366f1' : '#06b6d4'))
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', (d) => (d.type === 'zigbee' ? '6,3' : 'none'))
      .attr('opacity', 0.7);

    // Etykiety LQI / IP na połączeniach
    const linkLabelGroup = g.append('g').attr('class', 'link-labels');
    const linkLabels = linkLabelGroup
      .selectAll('text')
      .data(links)
      .enter()
      .append('text')
      .attr('fill', (d) => (d.type === 'wifi' ? '#a5b4fc' : '#67e8f9'))
      .attr('font-size', '9px')
      .attr('font-family', 'monospace')
      .attr('text-anchor', 'middle')
      .text((d) => (d.type === 'wifi' ? (d.ip?.replace('wifi_', '').replace(/_/g, '.') || 'Wi-Fi') : `LQI ${d.lqi || 255}`));

    // Rysowanie węzłów (Nodes)
    const nodeGroup = g.append('g').attr('class', 'nodes');
    const nodeElements = nodeGroup
      .selectAll<SVGGElement, TopologyNode>('g')
      .data(allNodes)
      .enter()
      .append('g')
      .attr('class', 'node')
      .style('cursor', 'pointer')
      .call(
        d3.drag<SVGGElement, TopologyNode>()
          .on('start', (event, d) => {
            if (!event.active && this.simulation) this.simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active && this.simulation) this.simulation.alphaTarget(0);
            if (!d.isCoordinator) {
              d.fx = null;
              d.fy = null;
            }
          }),
      );

    // Okręgi węzłów
    nodeElements
      .append('circle')
      .attr('r', (d) => (d.isCoordinator ? 28 : 22))
      .attr('fill', (d) => (d.isCoordinator ? 'url(#coordGrad)' : (d.type === 'wifi' ? '#312e81' : '#164e63')))
      .attr('stroke', (d) => (d.isCoordinator ? '#38bdf8' : (d.type === 'wifi' ? '#818cf8' : '#22d3ee')))
      .attr('stroke-width', (d) => (d.isCoordinator ? 3 : 2))
      .attr('filter', (d) => (d.isCoordinator ? 'url(#glow)' : 'none'));

    // Etykieta nazwy węzła
    nodeElements
      .append('text')
      .attr('dy', (d) => (d.isCoordinator ? 42 : 36))
      .attr('text-anchor', 'middle')
      .attr('fill', '#ffffff')
      .attr('font-size', '11px')
      .attr('font-weight', 'bold')
      .attr('font-family', 'sans-serif')
      .text((d) => d.name);

    // Podetykieta modelu
    nodeElements
      .append('text')
      .attr('dy', (d) => (d.isCoordinator ? 54 : 48))
      .attr('text-anchor', 'middle')
      .attr('fill', '#94a3b8')
      .attr('font-size', '9px')
      .attr('font-family', 'monospace')
      .text((d) => d.model);

    // Interakcja kliknięcia
    nodeElements.on('click', (_event, d) => {
      this.selectedNode.set(d);
    });

    // Aktualizacja pozycji po każdym kroku symulacji D3
    this.simulation.on('tick', () => {
      linkElements
        .attr('x1', (d) => (d.source as TopologyNode).x || 0)
        .attr('y1', (d) => (d.source as TopologyNode).y || 0)
        .attr('x2', (d) => (d.target as TopologyNode).x || 0)
        .attr('y2', (d) => (d.target as TopologyNode).y || 0);

      linkLabels
        .attr('x', (d) => (((d.source as TopologyNode).x || 0) + ((d.target as TopologyNode).x || 0)) / 2)
        .attr('y', (d) => (((d.source as TopologyNode).y || 0) + ((d.target as TopologyNode).y || 0)) / 2 - 5);

      nodeElements.attr('transform', (d) => `translate(${d.x || 0},${d.y || 0})`);
    });
  }
}
