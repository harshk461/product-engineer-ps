import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Subject } from 'rxjs';
import {
  REALTIME_ACTIVITY_CHANNEL,
  REALTIME_NAMESPACE,
  REALTIME_STATS_CHANNEL,
  RealtimeEvent,
} from '../common/realtime-event';

/**
 * Observability transport, never persistence.
 *
 * Nothing in the delivery path waits on, or branches on, a websocket emit. If
 * no dashboard is connected the events are simply dropped -- delivery state
 * lives in MySQL and the dashboard re-reads it over REST when it reconnects.
 */
@WebSocketGateway({
  namespace: REALTIME_NAMESPACE,
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);
  private connections = 0;

  @WebSocketServer()
  private server?: Server;

  /** In-process stream of everything published, used to drive stats broadcasts. */
  readonly activity$ = new Subject<RealtimeEvent>();

  handleConnection(client: Socket): void {
    this.connections += 1;
    this.logger.log(`Dashboard connected (${client.id}), ${this.connections} live`);
  }

  handleDisconnect(client: Socket): void {
    this.connections = Math.max(0, this.connections - 1);
    this.logger.log(`Dashboard disconnected (${client.id}), ${this.connections} live`);
  }

  get connectionCount(): number {
    return this.connections;
  }

  publish(event: RealtimeEvent): void {
    // Emitted twice on purpose: once on a single firehose channel the activity
    // feed subscribes to, once under its own name so a client can listen to
    // just the transitions it cares about.
    this.server?.emit(REALTIME_ACTIVITY_CHANNEL, event);
    this.server?.emit(event.type, event);
    this.activity$.next(event);
  }

  broadcastStats(stats: unknown): void {
    this.server?.emit(REALTIME_STATS_CHANNEL, stats);
  }
}
