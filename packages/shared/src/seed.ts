import { getService } from "./catalog";
import type {
  Activity,
  Department,
  Leader,
  Task,
  WorkspaceState,
} from "./types";

export const DEMO_LEADERS: Record<Department, Leader> = {
  "cell-0": {
    id: "leader-matthew",
    name: "Matthew Cell0",
    email: "matthew.cell0@example.org",
    rank: "BJN",
    department: "cell-0",
    approved: true,
  },
  sound: {
    id: "leader-sound",
    name: "Grace Ndlovu",
    email: "grace.sound@example.org",
    rank: "GJN",
    department: "sound",
    approved: true,
  },
  design: {
    id: "leader-design",
    name: "Grace Mokoena",
    email: "grace.design@example.org",
    rank: "GJN",
    department: "design",
    approved: true,
  },
  "visual-media": {
    id: "leader-visual",
    name: "Grace Dlamini",
    email: "grace.visual@example.org",
    rank: "GJN",
    department: "visual-media",
    approved: true,
  },
};

export function getDemoLeaderByDepartment(department: Department): Leader {
  return { ...DEMO_LEADERS[department] };
}

export function createSeedState(): WorkspaceState {
  const now = new Date();
  const iso = (offsetDays: number, hour = 12) => {
    const date = new Date(now);
    date.setDate(date.getDate() + offsetDays);
    date.setHours(hour, 0, 0, 0);
    return date.toISOString();
  };
  const users: Leader[] = [
    ...Object.values(DEMO_LEADERS).map((leader) => ({ ...leader })),
    {
      id: "leader-pending",
      name: "Thabo Nkosi",
      email: "thabo@example.org",
      rank: "TJN",
      department: "design",
      approved: false,
    },
  ];
  const titles = [
    "Sunday service opening montage",
    "Youth night highlight photos",
    "Community outreach poster",
    "Choir microphones and stage mix",
    "Women’s conference countdown graphics",
    "Volunteer appreciation banner",
    "Sunday sermon recording",
    "Missions week social reel",
    "Podcast episode sound clean-up",
    "Evening service livestream",
    "Baptism testimony edit",
    "Archive Easter service recording",
    "Children’s day photo coverage",
    "New members class invitation",
    "Guest speaker sound check",
    "Youth camp promo animation",
    "Community pantry print run",
    "Pastoral care interview recording",
    "Worship rehearsal capture",
    "Family service recap video",
    "Prayer week announcement slides",
    "Men’s breakfast event photos",
    "Church anniversary livestream",
    "Outreach story edit",
  ];
  const taskServices = [
    ["Sunday Services", "video-creation"],
    ["Youth Ministry", "event-photography"],
    ["Community Outreach", "graphic-design"],
    ["Worship", "live-sound"],
    ["Women’s Ministry", "motion-graphics"],
    ["Administration", "banners"],
    ["Sunday Services", "sermon-recording"],
    ["Missions", "social-content"],
    ["Communications", "sound-editing"],
    ["Sunday Services", "streaming"],
    ["Pastoral Care", "video-editing"],
    ["Sunday Services", "previously-aired-video"],
    ["Children’s Ministry", "event-photography"],
    ["Discipleship", "flyers"],
    ["Sunday Services", "live-sound"],
    ["Youth Ministry", "motion-graphics"],
    ["Community Outreach", "print-production"],
    ["Pastoral Care", "sermon-recording"],
    ["Worship", "event-video"],
    ["Family Ministry", "video-editing"],
    ["Prayer Ministry", "graphic-design"],
    ["Men’s Ministry", "event-photography"],
    ["Sunday Services", "streaming"],
    ["Community Outreach", "video-editing"],
  ] as const;
  const tasks: Task[] = [
    ...titles.map((title, index): Task => {
      const [ministry, serviceId] = taskServices[index];
      const service = getService(serviceId)!;
      const progress = ([0, 25, 50, 75, 100] as const)[index % 5];
      const status =
        progress === 100
          ? "completed"
          : progress === 0
            ? "pending"
            : "in-progress";
      return {
        id: `task-demo-${String(index + 1).padStart(2, "0")}`,
        title,
        ministry,
        service: service.id,
        instructions: `Prepare ${title.toLowerCase()} for the next scheduled ministry event. Confirm delivery with the ministry lead.`,
        notes:
          "Coordinate timing with the Sunday service team and share the final material with the ministry lead.",
        department: service.department,
        subTeam: service.subTeam,
        status,
        priority: (["low", "medium", "high", "urgent"] as const)[index % 4],
        progress,
        dueAt: iso((index % 11) - 3, 10 + (index % 8)),
        createdAt: iso(-((index % 18) + 1)),
        ...(progress === 100 ? { completedAt: iso(-1) } : {}),
        privateNotes:
          index % 4 === 0
            ? [
                {
                  id: `note-demo-${index}`,
                  text: "Confirm the run of show with Cell 0 before publishing.",
                  author: "Matthew Cell0",
                  createdAt: iso(-1),
                },
              ]
            : [],
      };
    }),
    {
      id: "task-demo-cell0-01",
      title: "Cell 0 weekly operations review",
      ministry: "Administration",
      service: "internal",
      instructions:
        "Review the upcoming service schedule, open requests, and cross-team dependencies.",
      notes: "Keep leadership discussion and follow-up details within Cell 0.",
      department: "cell-0",
      subTeam: "Cell 0",
      status: "in-progress",
      priority: "high",
      progress: 50,
      dueAt: iso(2),
      createdAt: iso(-2),
      privateNotes: [
        {
          id: "note-demo-cell0-01",
          text: "Confirm the private leadership agenda before the meeting.",
          author: "Matthew Cell0",
          createdAt: iso(-1),
        },
      ],
    },
  ];
  const requests = [
    {
      id: "request-demo-1",
      reference: `MOC-${now.getFullYear()}-0001`,
      ministry: "Youth Ministry",
      service: "social-content",
      title: "Youth conference recap reel",
      instructions: "Create a short recap reel for social channels.",
      notes: "Use the approved event footage and include the conference theme.",
      dueAt: iso(5),
      airedDates: undefined,
      status: "pending" as const,
      createdAt: iso(-1),
      updatedAt: iso(-1),
    },
    {
      id: "request-demo-2",
      reference: `MOC-${now.getFullYear()}-0002`,
      ministry: "Sunday Services",
      service: "previously-aired-video",
      title: "Retrieve September service recording",
      instructions:
        "Please provide the Sunday service recording for the archive.",
      notes: "The communications team will use this for the church archive.",
      dueAt: iso(7),
      airedDates: [iso(-30).slice(0, 10)],
      status: "pending" as const,
      createdAt: iso(-2),
      updatedAt: iso(-2),
    },
    {
      id: "request-demo-3",
      reference: `MOC-${now.getFullYear()}-0003`,
      ministry: "Community Outreach",
      service: "print-production",
      title: "Food drive collection signs",
      instructions: "Print collection signs for the monthly food drive.",
      notes: "Please use the standard outreach colors.",
      dueAt: iso(9),
      airedDates: undefined,
      status: "approved" as const,
      createdAt: iso(-4),
      updatedAt: iso(-3),
      taskId: "task-demo-17",
    },
    {
      id: "request-demo-4",
      reference: `MOC-${now.getFullYear()}-0004`,
      ministry: "Worship",
      service: "live-sound",
      title: "Extra wireless microphone",
      instructions: "Prepare one additional wireless microphone for rehearsal.",
      notes: "The lead vocalist will need it for the full rehearsal.",
      dueAt: iso(10),
      airedDates: undefined,
      status: "rejected" as const,
      createdAt: iso(-5),
      updatedAt: iso(-4),
      rejectionReason:
        "Please submit this as part of the existing Sunday service sound request.",
    },
  ];
  const activities: Activity[] = [
    {
      id: "activity-demo-1",
      text: "Youth conference recap reel request submitted.",
      department: "cell-0",
      type: "request",
      createdAt: iso(-1),
    },
    {
      id: "activity-demo-2",
      text: "Food drive collection signs approved and routed to Art Production.",
      department: "design",
      type: "approval",
      taskId: "task-demo-17",
      createdAt: iso(-3),
    },
    {
      id: "activity-demo-3",
      text: "Sunday service opening montage is now 50% complete.",
      department: "visual-media",
      type: "progress",
      taskId: "task-demo-01",
      createdAt: iso(-1),
    },
    {
      id: "activity-demo-4",
      text: "Wireless microphone request returned for clarification.",
      department: "cell-0",
      type: "rejection",
      createdAt: iso(-4),
    },
  ];
  return {
    tasks,
    requests,
    users,
    activities,
    notifications: [
      {
        id: "notification-demo-1",
        text: "A new youth media request is waiting for review.",
        read: false,
        createdAt: iso(-1),
        department: "cell-0",
      },
      {
        id: "notification-demo-2",
        text: "Community pantry print run is due soon.",
        read: false,
        createdAt: iso(0),
        department: "design",
      },
      {
        id: "notification-demo-3",
        text: "Sermon recording task updated.",
        read: true,
        createdAt: iso(-1),
        department: "sound",
      },
    ],
  };
}
