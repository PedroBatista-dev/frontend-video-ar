import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { UserData } from './data.service';

@Injectable({ providedIn: 'root' })
export class ParticipantService {
  private backendUrl = 'http://localhost:3000/save-participant';

  constructor(private http: HttpClient) { }

  saveParticipant(userData: UserData): Observable<any> {
    return this.http.post<any>(this.backendUrl, userData);
  }
}