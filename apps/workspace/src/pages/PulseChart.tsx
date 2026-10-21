import { useEffect, useId, useRef, useState } from "react";
import {
  Chart,
  CategoryScale,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Filler,
  Tooltip,
} from "chart.js";

Chart.register(
  CategoryScale,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Filler,
  Tooltip,
);

export default function PulseChart({
  completed,
  months,
}: {
  completed: number[];
  months: string[];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart<"line"> | null>(null);
  const selected = useRef(0);
  const [announcement, setAnnouncement] = useState("");
  const helpId = useId();

  useEffect(() => {
    if (!canvas.current) return;
    const styles = getComputedStyle(canvas.current);
    const color = (name: string) => styles.getPropertyValue(name).trim();
    const font = { family: styles.fontFamily, size: 11 };
    const instance = new Chart(canvas.current, {
      type: "line",
      data: {
        labels: months,
        datasets: [
          {
            label: "Completed tasks",
            data: completed,
            borderColor: color("--brand-600"),
            backgroundColor: color("--brand-600"),
            borderWidth: 2,
            pointBackgroundColor: color("--surface"),
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointHitRadius: 16,
            fill: {
              target: "origin",
              above: `color-mix(in srgb, ${color("--brand-600")} 8%, transparent)`,
            },
            tension: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        layout: { padding: { top: 8, right: 12 } },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: color("--muted"),
              font,
              maxRotation: 0,
              autoSkip: false,
              callback(value) {
                return this.getLabelForValue(Number(value)).split(" ")[0];
              },
            },
          },
          y: {
            beginAtZero: true,
            suggestedMax: 4,
            border: { display: false, dash: [4, 4] },
            grid: { color: color("--line"), drawTicks: false },
            ticks: {
              color: color("--muted"),
              font,
              precision: 0,
              maxTicksLimit: 5,
              padding: 10,
            },
            title: {
              display: true,
              text: "Completed tasks",
              color: color("--muted"),
              font,
            },
          },
        },
        plugins: {
          tooltip: {
            displayColors: false,
            backgroundColor: color("--ink"),
            titleFont: font,
            bodyFont: font,
            padding: 10,
            callbacks: {
              label: ({ parsed }) =>
                `${parsed.y} ${parsed.y === 1 ? "task" : "tasks"} completed`,
            },
          },
        },
      },
    });
    chart.current = instance;
    return () => {
      instance.destroy();
      chart.current = null;
    };
  }, [completed, months]);

  function selectMonth(index: number) {
    const instance = chart.current;
    if (!instance) return;
    selected.current = index;
    const point = instance.getDatasetMeta(0).data[index];
    const elements = [{ datasetIndex: 0, index }];
    instance.setActiveElements(elements);
    instance.tooltip?.setActiveElements(elements, { x: point.x, y: point.y });
    instance.update("none");
    setAnnouncement(
      `${months[index]}: ${completed[index]} ${completed[index] === 1 ? "task" : "tasks"} completed`,
    );
  }

  return (
    <>
      <div className="dashboard-chart-wrap">
        <canvas
          ref={canvas}
          className="dashboard-pulse-chart"
          role="img"
          aria-label="Completed tasks over the last eight months"
          aria-describedby={helpId}
          tabIndex={0}
          onFocus={() => selectMonth(months.length - 1)}
          onBlur={() => {
            chart.current?.setActiveElements([]);
            chart.current?.tooltip?.setActiveElements([], { x: 0, y: 0 });
            chart.current?.update("none");
          }}
          onKeyDown={(event) => {
            let index = selected.current;
            if (event.key === "ArrowLeft") index = Math.max(0, index - 1);
            else if (event.key === "ArrowRight")
              index = Math.min(months.length - 1, index + 1);
            else if (event.key === "Home") index = 0;
            else if (event.key === "End") index = months.length - 1;
            else return;
            event.preventDefault();
            selectMonth(index);
          }}
        />
      </div>
      <p id={helpId} className="sr-only">
        Use the left and right arrow keys to explore monthly counts.
      </p>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      <table className="sr-only">
        <caption>Monthly completed tasks</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Completed tasks</th>
          </tr>
        </thead>
        <tbody>
          {months.map((month, index) => (
            <tr key={month}>
              <th scope="row">{month}</th>
              <td>{completed[index]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
